import { getKey } from './adapters.js'
import type { FS } from './fs.js'

export type FileRefEntry = {
    link?: string | undefined // for URLs
    placeholders: [string, string][]
}

export type FileRef = {
    file: string
    /**
     * multiple references in the same file
     * null when there is no link or placeholders just that it's referenced
     */
    refs: (FileRefEntry | null)[]
}

export interface Item {
    context?: string | undefined
    translations: Map<string, string | string[]>
    references: FileRef[]
    urlAdapters: string[] // for URLs
    // for things that should survive the round trip with the storage
    [key: string]: unknown
}

export function fillTranslations(item: Item, locales: string[]) {
    for (const loc of locales) {
        // fill empty translations
        if (item.translations.has(loc)) {
            continue
        }
        item.translations.set(loc, [])
    }
}

export const newItem = (init: Partial<Item> = {}, locales: string[]): Item => {
    if (!init.translations) {
        init.translations = new Map()
        fillTranslations(init as Item, locales)
    }
    return {
        translations: init.translations,
        context: init.context,
        references: init.references ?? [],
        urlAdapters: init.urlAdapters ?? [],
    }
}

export const itemIsUrl = (item: Item) => item.urlAdapters.length > 0
export const itemIsObsolete = (item: Item) => item.urlAdapters.length === 0 && item.references.length === 0

export type CatalogStorage = {
    /**
     * the key to check if two storages share the same location
     * e.g. this can be the dir for the pofile storage
     * two storages with same keys means they are the same/shared
     */
    key: string
    load(): Item[] | Promise<Item[]>
    save(items: Item[]): void | Promise<void>
    /** the files controlled by this storage, for e.g. for Vite to watch */
    files: string[]
}

export type Catalog = Map<string, Item> // by item key

export type StorageFactoryOpts = {
    locales: string[]
    root: string
    /** shared locale artifacts directory from the top-level config */
    localesDir: string
    sourceLocale: string
    fs: FS
}

export type StorageFactory = (opts: StorageFactoryOpts) => CatalogStorage | Promise<CatalogStorage>

export function migrateStorage(fromStorages: StorageFactory[], toStorage: StorageFactory): StorageFactory {
    return async opts => {
        const fromSts = await Promise.all(fromStorages.map(s => s(opts)))
        return {
            ...(await toStorage(opts)),
            files: fromSts.flatMap(s => s.files),
            load: async () => (await Promise.all(fromSts.map(st => st.load()))).flat(),
        }
    }
}

type ItemType = 'message' | 'url'

const keyAndFiles = (storages: CatalogStorage[]) => ({
    key: storages.map(s => s.key).join(),
    files: storages.flatMap(s => s.files),
})

export function storageByType(storages: Record<ItemType, StorageFactory>): StorageFactory {
    return async opts => {
        const promises: (CatalogStorage | Promise<CatalogStorage>)[] = []
        const types: ItemType[] = []
        for (const [typ, storage] of Object.entries(storages)) {
            types.push(typ as ItemType)
            promises.push(storage(opts))
        }
        const all = await Promise.all(promises)
        const byType = new Map<ItemType, CatalogStorage>(types.map((t, i) => [t, all[i]!]))
        return {
            ...keyAndFiles(all),
            load: async () => (await Promise.all(all.map(st => st.load()))).flat(),
            save: async items => {
                const urls: Item[] = []
                const txts: Item[] = []
                for (const item of items) {
                    ;(itemIsUrl(item) ? urls : txts).push(item)
                }
                const promises: (void | Promise<void>)[] = []
                if (urls.length) {
                    promises.push(byType.get('url')!.save(urls))
                }
                if (txts.length) {
                    promises.push(byType.get('message')!.save(txts))
                }
                await Promise.all(promises)
            },
        }
    }
}

export function mergeItemsByKey(allItems: Item[][], sourceLocale: string): Item[] {
    const items = new Map<string, Item>()
    for (const allItms of allItems) {
        for (const item of allItms) {
            const sourceTransl = item.translations.get(sourceLocale)
            if (!sourceTransl) {
                throw new Error(
                    `Source translation not found for in ${JSON.stringify(Array.from(item.translations.entries()))}`,
                )
            }
            const key = getKey(sourceTransl, item.context)
            const itemFull = items.get(key)
            if (!itemFull) {
                items.set(key, item)
                continue
            }
            for (const [locale, transl] of item.translations) {
                if (transl && !itemFull.translations.get(locale)) {
                    itemFull.translations.set(locale, transl)
                }
            }
        }
    }
    return Array.from(items.values())
}

export function storageByLocale(storages: [string[], StorageFactory][]): StorageFactory {
    return async opts => {
        const promises: (CatalogStorage | Promise<CatalogStorage>)[] = []
        for (const [locales, storage] of storages) {
            promises.push(storage({ ...opts, locales }))
        }
        const localesLeft = new Set(opts.locales)
        const all = await Promise.all(promises)
        for (const [locales] of storages) {
            for (const loc of locales) {
                localesLeft.delete(loc)
            }
        }
        return {
            ...keyAndFiles(all),
            load: async () => mergeItemsByKey(await Promise.all(all.map(st => st.load())), opts.sourceLocale),
            save: async items => {
                await Promise.all(all.map(s => s.save(items)))
            },
        }
    }
}
