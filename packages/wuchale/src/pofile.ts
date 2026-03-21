import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import PO from 'pofile'
import { getKey } from './adapters.js'
import { deepMergeObjects } from './config.js'
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

type POItem = InstanceType<typeof PO.Item>

const urlAdapterFlagPrefix = 'url:'

type Additionals = {
    comments: string[]
    flags: Record<string, boolean | undefined>
}

type AdditionalsByLoc = Map<string, Additionals>

function itemToPOItem(item: Item, locale: string, sourceLocale: string): POItem {
    const poi = new PO.Item()
    const id = item.translations.get(sourceLocale)!
    poi.msgid = id[0]
    poi.msgid_plural = id[1]
    poi.msgstr = item.translations.get(locale)!
    poi.msgctxt = item.context
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
                    comm.push(`${i}: ${ph}`)
                }
                return comm.join('; ')
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

function getItemId(poi: POItem) {
    const msgid = [poi.msgid]
    if (poi.msgid_plural) {
        msgid.push(poi.msgid_plural)
    }
    return msgid
}

function poitemToItemCommons(poi: POItem): Item {
    const msgid = getItemId(poi)
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
        const commSp = comm.split('; ')
        let phStart = 0
        if (urlAdapters.length) {
            // url
            refEnt.link = commSp[0]
            phStart++
        }
        for (const c of commSp.slice(phStart)) {
            const [i, ph] = c.split(': ', 2)
            refEnt.placeholders.push([Number(i), ph])
        }
        lastRef.refs.push(refEnt)
    }
    return {
        id: msgid,
        translations: new Map(),
        context: poi.msgctxt,
        references,
        urlAdapters,
    }
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
        try {
            return await new Promise((res, rej) => {
                PO.load(filename, (err, po) => {
                    if (err) {
                        rej(err)
                    } else {
                        res(po)
                    }
                })
            })
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err
            }
            return null
        }
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
        // then merge them
        const items: Item[] = []
        for (const poIs of poItems.values()) {
            const item = poitemToItemCommons(poIs.get(this.opts.sourceLocale)!)
            const additionals: AdditionalsByLoc = new Map()
            for (const loc of this.opts.locales) {
                const poi = poIs.get(loc)
                item.translations.set(loc, poi?.msgstr ?? [])
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
        return { items, pluralRules }
    }

    async saveRaw(items: POItem[], headers: POHeaders, locale: string, url: boolean) {
        const po = new PO()
        po.headers = headers
        po.items = items
        const filename = this.filesByLoc.get(locale)![Number(url)]
        await mkdir(this.opts.dir, { recursive: true })
        await new Promise<void>((res, rej) => {
            po.save(filename, err => {
                if (err) {
                    rej(err)
                } else {
                    res()
                }
            })
        })
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
            if (poItemsUrl.length > 0) {
                await this.saveRaw(poItemsUrl, headers, locale, true)
            }
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
    const pofOptsFull = deepMergeObjects(pofOpts, defaultOpts)
    return opts => new POFile({ ...pofOptsFull, ...opts })
}
