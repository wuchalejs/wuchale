import { resolve } from 'node:path'
import PO from 'pofile'
import { Message } from '../adapters.js'
import { color, type Logger } from '../log.js'
import { normalizeSep } from './files.js'

type POItem = InstanceType<typeof PO.Item>

export type FileRef = {
    file: string
    /**
     * multiple refs per file with multiple placeholders
     * and in the case of urls, **the first ones will be links**
     */
    refs: string[][]
}

const urlAdapterFlagPrefix = 'url:'

export interface Item {
    msgid: string[]
    msgstr: string[]
    context?: string
    references: FileRef[]
    comments: string[]
    urlAdapters: string[]
}

export const newItem = (init: Partial<Item> = {}): Item => ({
    msgid: init.msgid ?? [],
    msgstr: init.msgstr ?? [],
    context: init.context,
    references: init.references ?? [],
    comments: init.comments ?? [],
    urlAdapters: init.urlAdapters ?? [],
})

export const itemIsObsolete = (item: Item) => item.urlAdapters.length === 0 && item.references.length === 0

export function itemToPOItem(item: Item): POItem {
    const poi = new PO.Item()
    poi.msgid = item.msgid[0]
    poi.msgid_plural = item.msgid[1]
    poi.msgstr = item.msgstr
    poi.msgctxt = item.context
    item.references.sort((r1, r2) => (r1.file < r2.file ? -1 : 1)) // deterministic
    poi.references = item.references.flatMap(r => (r.refs.length ? r.refs : [[]]).map(_ => r.file))
    poi.extractedComments = item.references.filter(r => r.refs.length).flatMap(r => r.refs.map(ps => ps.join('; ')))
    for (const key of item.urlAdapters) {
        poi.flags[`${urlAdapterFlagPrefix}${key}`] = true
    }
    poi.obsolete = itemIsObsolete(item)
    return poi
}

export function poitemToItem(item: POItem): Item {
    const msgid = [item.msgid]
    if (item.msgid_plural) {
        msgid.push(item.msgid_plural)
    }
    const references: FileRef[] = []
    let lastRef: FileRef = { file: '', refs: [] }
    for (const [i, ref] of item.references.entries()) {
        if (ref !== lastRef.file) {
            lastRef = { file: ref, refs: [] }
            references.push(lastRef)
        }
        const comm = item.extractedComments[i]?.trim()
        if (!comm) {
            continue
        }
        lastRef.refs.push(comm.split('; '))
    }
    const urlAdapters: string[] = []
    for (const key in item.flags) {
        if (key.startsWith(urlAdapterFlagPrefix)) {
            urlAdapters.push(key.slice(urlAdapterFlagPrefix.length))
        }
    }
    return {
        msgid,
        msgstr: item.msgstr,
        context: item.msgctxt,
        comments: item.comments,
        references,
        urlAdapters,
    }
}

export type PluralRule = {
    nplurals: number
    plural: string
}

export const defaultPluralRule: PluralRule = {
    nplurals: 2,
    plural: 'n == 1 ? 0 : 1',
}

export type Catalog = Map<string, Item>

export class POFile {
    catalog: Catalog = new Map()
    headers: Record<string, string | undefined> = {}
    pluralRule: PluralRule = defaultPluralRule
    locale: string
    filename: string
    urlFilename: string
    logger: Logger
    adapterKey: string

    constructor(locale: string, dir: string, adapterKey: string, logger: Logger) {
        this.locale = locale
        this.adapterKey = adapterKey
        this.logger = logger
        this.filename = normalizeSep(resolve(dir, `${this.locale}.po`))
        this.urlFilename = normalizeSep(resolve(dir, `${this.locale}.url.po`))
    }

    async loadRaw(url: boolean, warn = true): Promise<PO | null> {
        const filename = url ? this.urlFilename : this.filename
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
            if (warn) {
                this.logger.warn(`${color.magenta(this.adapterKey)}: Catalog not found at ${color.cyan(filename)}`)
            }
            return null
        }
    }

    async load(separateUrls: boolean) {
        const po = await this.loadRaw(false)
        if (po == null) {
            return
        }
        this.headers = po.headers
        const pluralHeader = po.headers['Plural-Forms']
        if (pluralHeader) {
            this.pluralRule = <PluralRule>(<unknown>PO.parsePluralForms(pluralHeader))
            this.pluralRule.nplurals = Number(this.pluralRule.nplurals)
        } else {
            this.pluralRule = defaultPluralRule
        }
        const itemColl = [po.items]
        if (separateUrls) {
            const poUrl = await this.loadRaw(true)
            poUrl && itemColl.push(poUrl.items)
        }
        for (const poItems of itemColl) {
            for (const poItem of poItems) {
                const item = poitemToItem(poItem)
                const msgInfo = new Message(item.msgid, undefined, item.context)
                this.catalog.set(msgInfo.toKey(), item)
            }
        }
    }

    async saveRaw(url: boolean, items: POItem[]) {
        const po = new PO()
        po.headers = this.headers
        po.items = items
        await new Promise<void>((res, rej) => {
            po.save(url ? this.urlFilename : this.filename, err => {
                if (err) {
                    rej(err)
                } else {
                    res()
                }
            })
        })
    }

    async save(separateUrls: boolean) {
        const poItems: POItem[] = []
        const poItemsUrl: POItem[] = []
        for (const item of this.catalog.values()) {
            const poItem = itemToPOItem(item)
            if (item.urlAdapters.length > 0 && separateUrls) {
                poItemsUrl.push(poItem)
            } else {
                poItems.push(poItem)
            }
        }
        await this.saveRaw(false, poItems)
        if (poItemsUrl.length > 0) {
            await this.saveRaw(true, poItemsUrl)
        }
    }

    updateHeaders(locale: string, sourceLocale: string) {
        const updateHeaders = [
            ['Plural-Forms', [`nplurals=${this.pluralRule.nplurals}`, `plural=${this.pluralRule.plural};`].join('; ')],
            ['Source-Language', sourceLocale],
            ['Language', locale],
            ['MIME-Version', '1.0'],
            ['Content-Type', 'text/plain; charset=utf-8'],
            ['Content-Transfer-Encoding', '8bit'],
        ]
        for (const [key, val] of updateHeaders) {
            this.headers[key] = val
        }
        const now = new Date().toISOString()
        const defaultHeaders = [
            ['POT-Creation-Date', now],
            ['PO-Revision-Date', now],
        ]
        for (const [key, val] of defaultHeaders) {
            if (!this.headers[key]) {
                this.headers[key] = val
            }
        }
    }
}
