import { resolve } from 'node:path'
import PO from 'pofile'
import { getKey } from './adapters.js'
import { fillDefaults } from './config.js'
import {
    type FileRef,
    type FileRefEntry,
    type Item,
    itemIsObsolete,
    itemIsUrl,
    type PluralRule,
    type PluralRules,
    type SaveData,
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
    poi.msgid = id[0]
    poi.msgid_plural = id[1]
    poi.msgstr = item.translations.get(locale)!
    if (item.context) {
        poi.msgctxt = item.context
    }
    poi.references = item.references.flatMap(r => r.refs.map(_ => r.file))
    poi.extractedComments = item.references
        .flatMap(r =>
            r.refs.map(frEntry => {
                if (frEntry === null) {
                    return null
                }
                let comm: string[] = []
                if (frEntry.link) {
                    comm.push(frEntry.link)
                }
                for (const [i, ph] of frEntry.placeholders) {
                    comm.push(join([String(i), ph], ': '))
                }
                return join(comm, '; ')
            }),
        )
        .filter(c => c !== null)
    const additionals: AdditionalsByLoc = (item.additionals as AdditionalsByLoc) ?? new Map()
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
            refEnt.link = commSp[0]
            phStart++
        }
        for (const c of commSp.slice(phStart)) {
            const [i, ph] = split(c, ': ', 2)
            refEnt.placeholders.push([Number(i), ph])
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
    const id = [poItem.msgid]
    if (poItem.msgid_plural) {
        id.push(poItem.msgid_plural)
    }
    return id
}

function poitemsToItems(poItems: Iterable<Map<string, POItem>>, locales: string[], sourceLocale: string) {
    // then merge them
    const items: Item[] = []
    for (const poIs of poItems) {
        const basePoOtem = poIs.values().next().value! // ! as poIs exists because at least one exists
        const item = poitemToItemCommons(basePoOtem)
        const additionals: AdditionalsByLoc = new Map()
        for (const loc of locales) {
            const poi = poIs.get(loc)
            item.translations.set(loc, poi?.msgstr ?? (loc === sourceLocale ? getItemId(basePoOtem) : []))
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
        item.additionals = additionals
        items.push(item)
    }
    return items
}

export type POFileOptions = {
    dir: string
    separateUrls: boolean
}

export const defaultOpts: POFileOptions = {
    dir: 'src/locales',
    separateUrls: true,
}

type POHeaders = Record<string, string | undefined>

export class POFile {
    key: string
    opts: StorageFactoryOpts & POFileOptions
    filesByLoc: Map<string, [string, string]> = new Map() // main and url
    files: string[] = []

    constructor(opts: StorageFactoryOpts & POFileOptions) {
        this.opts = opts
        opts.dir = resolve(opts.root, opts.dir)
        this.key = opts.dir
        for (const locale of opts.locales) {
            const locFiles = [resolve(opts.dir, `${locale}.po`), resolve(opts.dir, `${locale}.url.po`)] as [
                string,
                string,
            ]
            this.filesByLoc.set(locale, locFiles)
            this.files.push(...locFiles)
        }
    }

    async loadRaw(locale: string, url: boolean): Promise<PO | null> {
        const filename = this.filesByLoc.get(locale)![Number(url)]
        const content = await this.opts.fs.read(filename)
        return content == null ? null : PO.parse(content)
    }

    async load(): Promise<SaveData> {
        const pluralRules: PluralRules = new Map()
        // by key, then by locale
        const poItems: Map<string, Map<string, POItem>> = new Map()
        // first, group by key
        for (const locale of this.opts.locales) {
            const po = await this.loadRaw(locale, false)
            if (po == null) {
                continue
            }
            const pluralHeader = po.headers['Plural-Forms']
            if (pluralHeader) {
                const pluralRule = PO.parsePluralForms(pluralHeader) as unknown as PluralRule
                pluralRule.nplurals = Number(pluralRule.nplurals)
                pluralRules.set(locale, pluralRule)
            }
            if (this.opts.separateUrls && this.opts.haveUrl) {
                const poUrl = await this.loadRaw(locale, true)
                poUrl && po.items.push(...poUrl.items)
            }
            for (const poItem of po.items) {
                const key = getKey(getItemId(poItem), poItem.msgctxt)
                if (!poItems.has(key)) {
                    poItems.set(key, new Map())
                }
                poItems.get(key)?.set(locale, poItem)
            }
        }
        return {
            items: poitemsToItems(poItems.values(), this.opts.locales, this.opts.sourceLocale),
            pluralRules,
        }
    }

    async saveRaw(items: POItem[], headers: POHeaders, locale: string, url: boolean) {
        const filename = this.filesByLoc.get(locale)![Number(url)]
        if (items.length === 0) {
            if (await this.opts.fs.exists(filename)) {
                await this.opts.fs.unlink(filename)
            }
            return
        }
        const po = new PO()
        po.headers = headers
        po.items = items
        await this.opts.fs.mkdir(this.opts.dir)
        await this.opts.fs.write(filename, po.toString())
    }

    async save(data: SaveData) {
        for (const locale of this.opts.locales) {
            const poItems: POItem[] = []
            const poItemsUrl: POItem[] = []
            for (const item of data.items) {
                const poItem = itemToPOItem(item, locale, this.opts.sourceLocale)
                if (itemIsUrl(item) && this.opts.separateUrls && this.opts.haveUrl) {
                    poItemsUrl.push(poItem)
                } else {
                    poItems.push(poItem)
                }
            }
            const headers = this.getHeaders(locale, data.pluralRules.get(locale)!)
            await this.saveRaw(poItems, headers, locale, false)
            await this.saveRaw(poItemsUrl, headers, locale, true)
        }
    }

    getHeaders(locale: string, pluralRule: PluralRule) {
        const updateHeaders = [
            ['Plural-Forms', `nplurals=${pluralRule.nplurals}; plural=${pluralRule.plural};`],
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
    return opts =>
        new POFile({
            ...opts,
            ...fillDefaults(pofOpts, { ...defaultOpts, dir: opts.localesDir }),
        })
}
