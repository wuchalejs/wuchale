import type { FS } from './fs.js'

export type FileRefEntry = {
    link?: string | undefined // for URLs
    placeholders: [number, string][]
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
    translations: Map<string, string[]>
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

export type PluralRule = {
    nplurals: number
    plural: string
}

export type PluralRules = Map<string, PluralRule>

export const defaultPluralRule: PluralRule = {
    nplurals: 2,
    plural: 'n == 1 ? 0 : 1',
}

export type SaveData = {
    pluralRules: PluralRules // will always be provided
    items: Item[]
}

export type LoadData = {
    pluralRules?: PluralRules | undefined // optional if it's the first time etc, will be filled by the default one
    items: Item[]
}

export type CatalogStorage = {
    /**
     * the key to check if two storages share the same location
     * e.g. this can be the dir for the pofile storage
     * two storages with same keys means they are the same/shared
     */
    key: string
    load(): LoadData | Promise<LoadData>
    save(data: SaveData): void | Promise<void>
    /** the files controlled by this storage, for e.g. for Vite to watch */
    files: string[]
}

export type Catalog = Map<string, Item> // by item key

export type StorageFactoryOpts = {
    locales: string[]
    root: string
    /** shared locale artifacts directory from the top-level config */
    localesDir: string
    /** whether the url is configured, can use to load separate url files */
    haveUrl: boolean
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
            load: async () => {
                const loadeds = await Promise.all(fromSts.map(st => st.load()))
                return {
                    pluralRules: loadeds[0]?.pluralRules,
                    items: loadeds.flatMap(l => l.items),
                }
            },
        }
    }
}
