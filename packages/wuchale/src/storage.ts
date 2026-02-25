export type FileRef = {
    file: string
    /**
     * multiple refs per file with multiple placeholders
     * and in the case of urls, **the first ones will be links**
     */
    refs: string[][]
}

export type Translation = {
    msgstr: string[]
    comments: string[]
}

export interface Item {
    msgid: string[]
    context?: string
    translations: Map<string, Translation>
    references: FileRef[]
    urlAdapters: string[]
}

export const newItem = (init: Partial<Item> = {}, locales: string[]): Item => {
    if (!init.translations) {
        init.translations = new Map()
        for (const locale of locales) {
            init.translations.set(locale, { msgstr: [], comments: [] })
        }
    }
    return {
        msgid: init.msgid ?? [],
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
