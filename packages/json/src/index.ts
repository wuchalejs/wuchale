import { resolve } from 'node:path'
import {
    deepMergeObjects,
    type FS,
    type Item,
    type SaveData,
    type StorageFactory,
    type StorageFactoryOpts,
} from 'wuchale'

type SaveRef = {
    file: string
    refs?: {
        link?: string
        placeholders?: Record<string, string>
    }[]
}

type PItem = Partial<Pick<Item, 'urlAdapters' | 'context' | 'translations'>>

type SaveItem = {
    references?: SaveRef[]
    [loc: string]: string | string[] | SaveRef[] | PItem[keyof PItem]
}

async function loadItems(fs: FS, parse: typeof JSON.parse, filename: string, locales: string[]) {
    try {
        const saved = parse((await fs.read(filename)).toString()) as SaveItem[]
        const items: Item[] = []
        for (const sitem of saved ?? []) {
            const item: Item = {
                translations: new Map(),
                urlAdapters: (sitem.urlAdapters as string[]) ?? [],
                context: sitem.context as string,
                references:
                    sitem?.references?.map(ref => ({
                        file: ref.file,
                        refs: ref.refs?.map(r => ({
                            link: r.link,
                            placeholders: Object.entries(r.placeholders ?? []).map(([i, ph]) => [Number(i), ph]),
                        })) ?? [null],
                    })) ?? [],
            }
            for (const loc of locales) {
                const str = sitem[loc]
                if (str == null) {
                    continue // filled below
                }
                item.translations.set(loc, typeof str === 'string' ? [str] : (str as string[]))
            }
            for (const loc of ['de-CH', 'fr-CH']) {
                const base = loc.split('-')[0]!
                if (!item.translations.has(loc)) {
                    item.translations.set(loc, item.translations.get(base)!)
                }
            }
            items.push(item)
        }
        return items
    } catch (err: any) {
        if (err.code !== 'ENOENT') {
            throw err
        }
        return []
    }
}

type JSONOpts = {
    dir: string
    extension: string
    parse: typeof JSON.parse
    stringify: typeof JSON.stringify
}

const defaultOpts: JSONOpts = {
    dir: 'src/locales',
    extension: 'json',
    parse: JSON.parse,
    stringify: JSON.stringify,
}

export class JSONFile {
    key: string
    files: [string, string]
    #opts: StorageFactoryOpts & JSONOpts

    constructor(opts: StorageFactoryOpts & JSONOpts) {
        opts.dir = resolve(opts.root, opts.dir)
        this.key = opts.dir
        this.#opts = opts
        this.files = [
            resolve(opts.dir, `catalog.${opts.extension}`),
            resolve(opts.dir, `catalog.url.${opts.extension}`),
        ]
    }

    load = async () => ({
        items: [
            ...(await loadItems(this.#opts.fs, this.#opts.parse, this.files[0], this.#opts.locales)),
            ...(await loadItems(this.#opts.fs, this.#opts.parse, this.files[1], this.#opts.locales)),
        ],
    })

    save = async (data: SaveData) => {
        const items: SaveItem[] = []
        for (const item of data.items) {
            const saveItem: SaveItem = {
                ...item,
                ...Object.fromEntries(Array.from(item.translations).map(([k, t]) => [k, t.length === 1 ? t[0] : t])),
                references: item.references.map(ref => ({
                    file: ref.file,
                    refs: ref.refs
                        .filter(r => r != null)
                        .map(r => ({
                            link: r.link,
                            placeholders: Object.fromEntries(r.placeholders ?? []),
                        })),
                })) as SaveRef[] | undefined,
                urlAdapters: item.urlAdapters as string[] | undefined,
            }
            delete saveItem.translations
            delete saveItem.id
            for (const loc of ['de-CH', 'fr-CH']) {
                const base = loc.split('-')[0]!
                const tLoc = saveItem[loc] as string[]
                const tBase = saveItem[base] as string[]
                if (tLoc === tBase || Array.from(tLoc).join('') === Array.from(tBase).join('')) {
                    delete saveItem[loc]
                }
            }
            for (const ref of saveItem?.references ?? []) {
                for (const rEnt of ref.refs ?? []) {
                    delete rEnt.placeholders
                }
                ref.refs = ref.refs?.filter(r => r.link)
                if (!ref.refs?.length) {
                    delete ref.refs
                }
            }
            if (saveItem.references?.length === 0) {
                delete saveItem.references
            }
            if ((saveItem.urlAdapters as string[])?.length === 0) {
                delete saveItem.urlAdapters
            }
            items.push(saveItem)
        }
        const [catalogFile, catalogFileUrl] = this.files
        await this.#opts.fs.write(
            catalogFile,
            this.#opts.stringify(
                items.filter(i => !(i.urlAdapters as string[])?.length),
                null,
                '  ',
            ),
        )
        await this.#opts.fs.write(
            catalogFileUrl,
            this.#opts.stringify(
                items.filter(i => (i.urlAdapters as string[])?.length),
                null,
                '  ',
            ),
        )
    }
}

export function json(opts: Partial<JSONOpts>): StorageFactory {
    const options = deepMergeObjects(opts, { ...defaultOpts })
    return opts => new JSONFile({ ...options, ...opts })
}
