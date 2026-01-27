import PO from 'pofile'
import { Message } from '../adapters.js'

export type ItemType = InstanceType<typeof PO.Item>

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
            const msgInfo = new Message([item.msgid, item.msgid_plural], undefined, item.msgctxt)
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

export async function loadCatalogFromPO(filename: string): Promise<POFile> {
    const po = await loadPOFile(filename)
    let pluralRule: PluralRule
    const pluralHeader = po.headers['Plural-Forms']
    if (pluralHeader) {
        pluralRule = <PluralRule>(<unknown>PO.parsePluralForms(pluralHeader))
        pluralRule.nplurals = Number(pluralRule.nplurals)
    } else {
        pluralRule = defaultPluralRule
    }
    return new POFile(po.items, pluralRule, po.headers as Record<string, string>)
}

export function poDumpToString(items: ItemType[]) {
    const po = new PO()
    po.items = items
    return po.toString()
}

export async function saveCatalogToPO(pofile: POFile, filename: string): Promise<void> {
    const po = new PO()
    po.headers = pofile.headers
    for (const item of pofile.catalog.values()) {
        po.items.push(item)
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
