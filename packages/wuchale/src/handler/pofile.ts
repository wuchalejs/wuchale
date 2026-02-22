import PO from 'pofile'
import { Message } from '../adapters.js'
import { color, type Logger } from '../log.js'

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

export interface ItemType {
    msgid: string[]
    msgstr: string[]
    context?: string
    references: FileRef[]
    comments: string[]
    urlAdapters: Set<string>
}

export const newItem = (init: Partial<ItemType> = {}): ItemType => ({
    msgid: init.msgid ?? [],
    msgstr: init.msgstr ?? [],
    context: init.context,
    references: init.references ?? [],
    comments: init.comments ?? [],
    urlAdapters: init.urlAdapters ?? new Set(),
})

export const itemIsObsolete = (item: ItemType) => item.urlAdapters.size === 0 && item.references.length === 0

export function itemToPOItem(item: ItemType): POItem {
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

export function poitemToItem(item: POItem): ItemType {
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
    const urlAdapters = new Set<string>()
    for (const key in item.flags) {
        if (key.startsWith(urlAdapterFlagPrefix)) {
            urlAdapters.add(key.slice(urlAdapterFlagPrefix.length))
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

export type Catalog = Map<string, ItemType>

export class POFile {
    catalog: Catalog = new Map()
    headers: Record<string, string>
    pluralRule: PluralRule

    constructor(items: ItemType[], pluralRule: PluralRule, headers: Record<string, string>) {
        for (const item of items) {
            const msgInfo = new Message(item.msgid, undefined, item.context)
            this.catalog.set(msgInfo.toKey(), item)
        }
        this.headers = headers
        this.pluralRule = pluralRule
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

export async function loadPOFile(filename: string): Promise<PO> {
    return new Promise((res, rej) => {
        PO.load(filename, (err, po) => {
            if (err) {
                rej(err)
            } else {
                res(po)
            }
        })
    })
}

export async function loadCatalogFromPO(
    filename: string,
    adapterKey: string,
    logger: Logger,
): Promise<POFile | undefined> {
    let po: PO
    try {
        po = await loadPOFile(filename)
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err
        }
        logger.warn(`${color.magenta(adapterKey)}: Catalog not found at ${color.cyan(filename)}`)
        return
    }
    let pluralRule: PluralRule
    const pluralHeader = po.headers['Plural-Forms']
    if (pluralHeader) {
        pluralRule = <PluralRule>(<unknown>PO.parsePluralForms(pluralHeader))
        pluralRule.nplurals = Number(pluralRule.nplurals)
    } else {
        pluralRule = defaultPluralRule
    }
    return new POFile(po.items.map(poitemToItem), pluralRule, po.headers as Record<string, string>)
}

export function poDumpToString(items: POItem[]) {
    const po = new PO()
    po.items = items
    return po.toString()
}

export async function saveCatalogToPO(pofile: POFile, filename: string): Promise<void> {
    const po = new PO()
    po.headers = pofile.headers
    for (const item of pofile.catalog.values()) {
        po.items.push(itemToPOItem(item))
    }
    return new Promise((res, rej) => {
        po.save(filename, err => {
            if (err) {
                rej(err)
            } else {
                res()
            }
        })
    })
}
