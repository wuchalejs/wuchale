import { dirname, resolve } from 'node:path'
import PO from 'pofile'
import { getKey } from './adapters.js'
import { fillDefaults } from './config.js'
import {
    type FileRef,
    type FileRefEntry,
    type Item,
    itemIsObsolete,
    type StorageFactory,
    type StorageFactoryOpts,
} from './storage.js'

export type POItem = InstanceType<typeof PO.Item>

const urlAdapterFlagPrefix = 'url:'

type Additionals = {
    comments: string[]
    flags: Record<string, boolean | undefined>
}

type AdditionalsByLoc = Map<string, Additionals>

function join(parts: string[], sep: string) {
    return parts.map(s => s.replaceAll('\\', '\\\\').replaceAll(sep, `\\${sep}`)).join(sep)
}

function split(str: string, sep: string, count?: number) {
    return str
        .split(new RegExp(`(?<!\\\\)${sep}`), count)
        .map(s => s.replaceAll(`\\${sep}`, sep).replaceAll('\\\\', '\\'))
}

function itemToPOItem(item: Item, locale: string, sourceLocale: string): POItem {
    const poi = new PO.Item()
    const id = item.translations.get(sourceLocale)!
    const body = item.translations.get(locale)!
    if (typeof id === 'string') {
        poi.msgid = id
        poi.msgstr = [body as string]
    } else {
        poi.msgid = id[0]!
        poi.msgid_plural = id[1] ?? ''
        poi.msgstr = body as string[]
    }
    if (item.context) {
        poi.msgctxt = item.context
    }
    for (const ref of item.references) {
        for (const entry of ref.refs) {
            poi.references.push(ref.file)
            if (entry === null) {
                poi.extractedComments.push('')
                continue
            }
            const comm: string[] = []
            if (entry.link) {
                comm.push(entry.link)
            }
            for (const [i, ph] of entry.placeholders) {
                comm.push(join([String(i), ph], ': '))
            }
            poi.extractedComments.push(join(comm, '; '))
        }
    }
    if (!poi.extractedComments.some(c => c !== '')) {
        poi.extractedComments = []
    }
    const additionals: AdditionalsByLoc = (item['additionals'] as AdditionalsByLoc) ?? new Map()
    poi.comments = additionals.get(locale)?.comments ?? []
    poi.flags = additionals.get(locale)?.flags ?? {}
    for (const key of item.urlAdapters) {
        poi.flags[`${urlAdapterFlagPrefix}${key}`] = true
    }
    poi.obsolete = itemIsObsolete(item)
    return poi
}

function poitemToItemCommons(poi: POItem): Item {
    const references: FileRef[] = []
    let lastRef: FileRef = { file: '', refs: [] }
    const urlAdapters: string[] = []
    for (const key in poi.flags) {
        if (key.startsWith(urlAdapterFlagPrefix)) {
            urlAdapters.push(key.slice(urlAdapterFlagPrefix.length))
        }
    }
    for (const [i, ref] of poi.references.entries()) {
        if (ref !== lastRef.file) {
            lastRef = { file: ref, refs: [] }
            references.push(lastRef)
        }
        const comm = poi.extractedComments[i]?.trim()
        if (!comm) {
            lastRef.refs.push(null)
            continue
        }
        const refEnt: FileRefEntry = { placeholders: [] }
        const commSp = split(comm, '; ')
        let phStart = 0
        if (urlAdapters.length) {
            // url
            refEnt.link = commSp[0]!
            phStart++
        }
        for (const c of commSp.slice(phStart)) {
            const [i, ph] = split(c, ': ', 2)
            refEnt.placeholders.push([i!, ph!])
        }
        lastRef.refs.push(refEnt)
    }
    return {
        translations: new Map(),
        context: poi.msgctxt,
        references,
        urlAdapters,
    }
}

function getItemId(poItem: POItem) {
    if (poItem.msgid_plural == null) {
        return poItem.msgid
    }
    return [poItem.msgid, poItem.msgid_plural]
}

function poitemsToItems(poItems: Iterable<Map<string, POItem>>, locales: string[], sourceLocale: string) {
    // then merge them
    const items: Item[] = []
    for (const poIs of poItems) {
        const basePoOtem = poIs.values().next().value! // ! as poIs exists because at least one exists
        const item = poitemToItemCommons(basePoOtem)
        const additionals: AdditionalsByLoc = new Map()
        const id = getItemId(basePoOtem)
        for (const loc of locales) {
            const poi = poIs.get(loc)
            item.translations.set(
                loc,
                loc === sourceLocale ? id : typeof id === 'string' ? (poi?.msgstr?.[0] ?? '') : (poi?.msgstr ?? []),
            )
            const add: Additionals = {
                comments: poi?.comments ?? [],
                flags: {},
            }
            for (const [k, v] of Object.entries(poi?.flags ?? {})) {
                if (!k.startsWith(urlAdapterFlagPrefix)) {
                    add.flags[k] = v
                }
            }
            additionals.set(loc, add)
        }
        item['additionals'] = additionals
        items.push(item)
    }
    return items
}

export type POFileOptions = {
    /** in the form like 'path/to/dir/{locale}.po' */
    location: string
}

export const defaultOpts: POFileOptions = {
    location: 'src/locales/{locale}.po',
}

type POHeaders = Record<string, string | undefined>

export class POFile {
    key: string
    opts: StorageFactoryOpts & POFileOptions
    filesByLoc: Map<string, string> = new Map() // main and url
    files: string[] = []
    fileExistsCache: Map<string, boolean> = new Map()

    constructor(opts: StorageFactoryOpts & POFileOptions) {
        this.opts = opts
        opts.location = resolve(opts.root, opts.location)
        this.key = opts.location
        for (const locale of opts.locales) {
            const location = opts.location.replace('{locale}', locale)
            this.filesByLoc.set(locale, location)
            this.files.push(location)
        }
    }

    async loadRaw(locale: string): Promise<PO | null> {
        const filename = this.filesByLoc.get(locale)!
        const content = await this.opts.fs.read(filename)
        this.fileExistsCache.set(filename, content != null)
        return content == null ? null : PO.parse(content)
    }

    async load(): Promise<Item[]> {
        // by key, then by locale
        const poItems: Map<string, Map<string, POItem>> = new Map()
        // first, group by key
        for (const locale of this.opts.locales) {
            const po = await this.loadRaw(locale)
            if (po == null) {
                continue
            }
            for (const poItem of po.items) {
                const key = getKey(getItemId(poItem), poItem.msgctxt)
                if (!poItems.has(key)) {
                    poItems.set(key, new Map())
                }
                poItems.get(key)?.set(locale, poItem)
            }
        }
        return poitemsToItems(poItems.values(), this.opts.locales, this.opts.sourceLocale)
    }

    async saveRaw(items: POItem[], headers: POHeaders, locale: string) {
        const filename = this.filesByLoc.get(locale)!
        if (items.length === 0) {
            if (this.fileExistsCache.get(filename) === false) {
                return
            }
            await this.opts.fs.unlink(filename)
            this.fileExistsCache.set(filename, false)
            return
        }
        const po = new PO()
        po.headers = headers
        po.items = items
        await this.opts.fs.write(filename, po.toString())
        this.fileExistsCache.set(filename, true)
    }

    async save(items: Item[]) {
        await Promise.all(
            this.opts.locales.map(locale => {
                const poItems: POItem[] = []
                for (const item of items) {
                    const poItem = itemToPOItem(item, locale, this.opts.sourceLocale)
                    poItems.push(poItem)
                }
                return this.saveRaw(poItems, this.getHeaders(locale), locale)
            }),
        )
    }

    getHeaders(locale: string) {
        const updateHeaders: [string, string][] = [
            ['Source-Language', this.opts.sourceLocale],
            ['Language', locale],
            ['MIME-Version', '1.0'],
            ['Content-Type', 'text/plain; charset=utf-8'],
            ['Content-Transfer-Encoding', '8bit'],
        ]
        const headers: POHeaders = {}
        for (const [key, val] of updateHeaders) {
            headers[key] = val
        }
        return headers
    }
}

export function pofile(pofOpts: Partial<POFileOptions> = {}): StorageFactory {
    return async opts => {
        const defaultLocation = resolve(opts.root, opts.localesDir, '{locale}.po')
        const fullOpts = fillDefaults(pofOpts, { ...defaultOpts, location: defaultLocation })
        await opts.fs.mkdir(dirname(resolve(opts.root, fullOpts.location))) // create once
        if (!fullOpts.location.includes('{locale}')) {
            throw new Error('PO file `location` config has to include `{locale}`')
        }
        return new POFile({ ...opts, ...fullOpts })
    }
}
