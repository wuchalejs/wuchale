import { isAbsolute, resolve } from 'node:path'
import PO from 'pofile'
import { Message } from './adapters.js'
import { deepMergeObjects } from './config.js'
import { color } from './log.js'
import {
    type Catalog,
    type CatalogStorage,
    defaultPluralRule,
    type FileRef,
    type Item,
    itemIsObsolete,
    itemIsUrl,
    type PluralRule,
    type StorageFactory,
    type StorageFactoryOpts,
} from './storage.js'

type POItem = InstanceType<typeof PO.Item>

const urlAdapterFlagPrefix = 'url:'

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

export type POFileOptions = {
    dir: string
    separateUrls: boolean
}

export const defaultOpts: POFileOptions = {
    dir: 'src/locales',
    separateUrls: true,
}

export class POFile {
    catalog: Catalog = new Map()
    headers: Record<string, string | undefined> = {}
    pluralRule: PluralRule = defaultPluralRule
    locale: string
    opts: StorageFactoryOpts & POFileOptions
    files: [string, string] // main and url

    constructor(locale: string, opts: StorageFactoryOpts & POFileOptions) {
        this.locale = locale
        this.opts = opts
        if (!isAbsolute(opts.dir)) {
            opts.dir = resolve(opts.root, opts.dir)
        }
        this.files = [resolve(opts.dir, `${locale}.po`), resolve(opts.dir, `${locale}.url.po`)]
    }

    async loadRaw(url: boolean, warn = true): Promise<PO | null> {
        const filename = this.files[Number(url)]
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
                this.opts.log.warn(
                    `${color.magenta(this.opts.adapterKey)}: Catalog not found at ${color.cyan(filename)}`,
                )
            }
            return null
        }
    }

    async load() {
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
        if (this.opts.separateUrls && this.opts.haveUrl) {
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
            po.save(this.files[Number(url)], err => {
                if (err) {
                    rej(err)
                } else {
                    res()
                }
            })
        })
    }

    async save() {
        this.updateHeaders()
        const poItems: POItem[] = []
        const poItemsUrl: POItem[] = []
        for (const item of this.catalog.values()) {
            const poItem = itemToPOItem(item)
            if (itemIsUrl(item) && this.opts.separateUrls && this.opts.haveUrl) {
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

    updateHeaders() {
        const updateHeaders = [
            ['Plural-Forms', [`nplurals=${this.pluralRule.nplurals}`, `plural=${this.pluralRule.plural};`].join('; ')],
            ['Source-Language', this.opts.sourceLocale],
            ['Language', this.locale],
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

export function pofile(pofOpts: Partial<POFileOptions> = {}): StorageFactory {
    const pofOptsFull = deepMergeObjects(pofOpts, defaultOpts)
    return opts => {
        const storages = new Map<string, CatalogStorage>()
        for (const locale of opts.locales) {
            storages.set(locale, new POFile(locale, { ...pofOptsFull, ...opts }))
        }
        return {
            key: resolve(pofOptsFull.dir),
            get: locale => storages.get(locale)!,
        }
    }
}
