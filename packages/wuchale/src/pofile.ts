import { mkdir } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import PO from 'pofile'
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
    type Translation,
} from './storage.js'

type POItem = InstanceType<typeof PO.Item>

const urlAdapterFlagPrefix = 'url:'

export function itemToPOItem(item: Item, locale: string): POItem {
    const poi = new PO.Item()
    poi.msgid = item.id[0]
    poi.msgid_plural = item.id[1]
    poi.msgstr = item.translations.get(locale)?.text!
    poi.msgctxt = item.context
    item.references.sort((r1, r2) => (r1.file < r2.file ? -1 : 1)) // deterministic
    poi.references = item.references.flatMap(r => (r.refs.length ? r.refs : [{ placeholders: [] }]).map(_ => r.file))
    poi.extractedComments = item.references
        .filter(r => r.refs.length)
        .flatMap(r =>
            r.refs.map(frEntry => {
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
    for (const key of item.urlAdapters) {
        poi.flags[`${urlAdapterFlagPrefix}${key}`] = true
    }
    poi.obsolete = itemIsObsolete(item)
    return poi
}

export function poitemToItem(item: POItem, locale: string): Item {
    const msgid = [item.msgid]
    if (item.msgid_plural) {
        msgid.push(item.msgid_plural)
    }
    const references: FileRef[] = []
    let lastRef: FileRef = { file: '', refs: [] }
    const urlAdapters: string[] = []
    for (const key in item.flags) {
        if (key.startsWith(urlAdapterFlagPrefix)) {
            urlAdapters.push(key.slice(urlAdapterFlagPrefix.length))
        }
    }
    for (const [i, ref] of item.references.entries()) {
        if (ref !== lastRef.file) {
            lastRef = { file: ref, refs: [] }
            references.push(lastRef)
        }
        const comm = item.extractedComments[i]?.trim()
        if (!comm) {
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
    const translations: Map<string, Translation> = new Map()
    translations.set(locale, {
        text: item.msgstr,
        comments: item.comments,
    })
    return {
        id: msgid,
        translations,
        context: item.msgctxt,
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
        if (!isAbsolute(opts.dir)) {
            opts.dir = resolve(opts.root, opts.dir)
        }
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
        const items: Item[] = []
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
            for (const [i, poItem] of po.items.entries()) {
                let item = items[i]
                if (!item) {
                    items[i] = poitemToItem(poItem, locale)
                } else {
                    item.translations.set(locale, {
                        text: poItem.msgstr,
                        comments: poItem.comments,
                    })
                }
            }
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
                const poItem = itemToPOItem(item, locale)
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
            ['Plural-Forms', [`nplurals=${pluralRule.nplurals}`, `plural=${pluralRule.plural};`].join('; ')],
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
        const now = new Date().toISOString()
        const defaultHeaders = [
            ['POT-Creation-Date', now],
            ['PO-Revision-Date', now],
        ]
        for (const [key, val] of defaultHeaders) {
            if (!headers[key]) {
                headers[key] = val
            }
        }
        return headers
    }
}

export function pofile(pofOpts: Partial<POFileOptions> = {}): StorageFactory {
    const pofOptsFull = deepMergeObjects(pofOpts, defaultOpts)
    return opts => new POFile({ ...pofOptsFull, ...opts })
}
