import type { Logger } from './log.js'

export type FileRef = {
    file: string
    /**
     * multiple refs per file with multiple placeholders
     * and in the case of urls, **the first ones will be links**
     */
    refs: string[][]
}

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

export const itemIsUrl = (item: Item) => item.urlAdapters.length > 0
export const itemIsObsolete = (item: Item) => item.urlAdapters.length === 0 && item.references.length === 0

export type Catalog = Map<string, Item>

export type PluralRule = {
    nplurals: number
    plural: string
}

export const defaultPluralRule: PluralRule = {
    nplurals: 2,
    plural: 'n == 1 ? 0 : 1',
}

export type CatalogStorage = {
    pluralRule: PluralRule
    catalog: Catalog
    load(): Promise<void>
    save(): Promise<void>
    /** the files controlled by this storage, for e.g. for Vite to watch */
    files: string[]
}

export type StorageFactoryOpts = {
    locales: string[]
    root: string
    sourceLocale: string
    localesDir: string
    adapterKey: string
    log: Logger
}

export type StorageCollection = {
    /**
     * the key to check if two storages share the same location
     * e.g. this can be the dir for the pofile storage
     * two storages with same keys means they are the same/shared
     */
    key: string
    get: (locale: string) => CatalogStorage
}

export type StorageFactory = (opts: StorageFactoryOpts) => StorageCollection
