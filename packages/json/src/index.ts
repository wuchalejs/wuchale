import { resolve } from 'node:path'
import { deepMergeObjects, type Item, type SaveData, type StorageFactory, type StorageFactoryOpts } from 'wuchale'

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

    async loadRaw(filename: string) {
        const content = await this.#opts.fs.read(filename)
        if (content === null) {
            return []
        }
        const saved = this.#opts.parse(content) as SaveItem[]
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
            for (const loc of this.#opts.locales) {
                const str = sitem[loc]
                if (str == null) {
                    continue // filled below
                }
                item.translations.set(loc, typeof str === 'string' ? [str] : (str as string[]))
            }
            for (const loc of this.#opts.locales) {
                const [base, region] = loc.split('-')
                if (!region) {
                    continue
                }
                if (!item.translations.has(loc)) {
                    item.translations.set(loc, item.translations.get(base)!)
                }
            }
            items.push(item)
        }
        return items
    }

    load = async () => ({
        items: [...(await this.loadRaw(this.files[0])), ...(await this.loadRaw(this.files[1]))],
    })

    saveRaw = async (filename: string, items: SaveItem[]) => {
        if (items.length === 0) {
            await this.#opts.fs.unlink(filename)
            return
        }
        await this.#opts.fs.write(filename, this.#opts.stringify(items, null, '  '))
    }

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
            for (const loc of this.#opts.locales) {
                const [base, reg] = loc.split('-')
                if (!reg) {
                    continue
                }
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
        await this.saveRaw(
            this.files[0],
            items.filter(i => !(i.urlAdapters as string[])?.length),
        )
        await this.saveRaw(
            this.files[1],
            items.filter(i => (i.urlAdapters as string[])?.length),
        )
    }
}

export function json(jsonOpts: Partial<JSONOpts>): StorageFactory {
    return opts =>
        new JSONFile({
            ...opts,
            ...deepMergeObjects(jsonOpts, { ...defaultOpts, dir: opts.localesDir }),
        })
}
