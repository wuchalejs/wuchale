export type FileRefEntry = {
    link?: string
    placeholders: [number, string][]
}

export type FileRef = {
    file: string
    refs: FileRefEntry[]
}

export type Translation = {
    text: string[]
    comments: string[]
}

export interface Item {
    id: string[]
    context?: string
    translations: Map<string, Translation>
    references: FileRef[]
    urlAdapters: string[]
}

export function fillTranslations(item: Item, locales: string[]) {
    for (const loc of locales) {
        // fill empty translations
        if (item.translations.has(loc)) {
            continue
        }
        item.translations.set(loc, { text: [], comments: [] })
    }
}

export const newItem = (init: Partial<Item> = {}, locales: string[]): Item => {
    if (!init.translations) {
        init.translations = new Map()
        fillTranslations(init as Item, locales)
    }
    return {
        id: init.id ?? [],
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
    pluralRules: PluralRules
    items: Item[]
}

export type LoadData = {
    pluralRules?: PluralRules
    items: Iterable<Item>
}

export type CatalogStorage = {
    /**
     * the key to check if two storages share the same location
     * e.g. this can be the dir for the pofile storage
     * two storages with same keys means they are the same/shared
     */
    key: string
    load(): Promise<LoadData>
    save(items: SaveData): Promise<void>
    /** the files controlled by this storage, for e.g. for Vite to watch */
    files: string[]
}

export type Catalog = Map<string, Item> // by item key

export type StorageFactoryOpts = {
    locales: string[]
    root: string
    /** whether the url is configured, can use to load separate url files */
    haveUrl: boolean
    sourceLocale: string
}

export type StorageFactory = (opts: StorageFactoryOpts) => CatalogStorage
