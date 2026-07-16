import { dirname, resolve } from 'node:path'
import { type FileRefEntry, fillDefaults, type Item, type StorageFactory, type StorageFactoryOpts } from 'wuchale'

type SaveRefMin = {
    file: string
    links?: string[] | undefined
}

type SaveRefFull = {
    file: string
    refs?: {
        link?: string | undefined
        placeholders: Record<string, string>
    }[]
}

type SaveItem = Partial<Pick<Item, 'urlAdapters' | 'context'>> & {
    references?: (SaveRefMin | SaveRefFull)[]
    translations?: Record<string, string | string[]>
    [loc: string]: unknown // translations flattened
}

type JSONOpts = {
    /** can include `{locale}` when used for specific locales */
    location: string
    mergeSameRegionals: boolean
    removePlaceholders: boolean
    flattenTranslations: boolean
    parse: typeof JSON.parse
    stringify: typeof JSON.stringify
}

const defaultOpts: JSONOpts = {
    location: 'src/locales/catalog.json',
    mergeSameRegionals: false,
    removePlaceholders: false,
    flattenTranslations: false,
    parse: JSON.parse,
    stringify: JSON.stringify,
}

export class JSONFile {
    key: string
    files: [string]
    #opts: StorageFactoryOpts & JSONOpts

    constructor(opts: StorageFactoryOpts & JSONOpts) {
        opts.location = resolve(opts.root, opts.location)
        this.key = opts.location
        this.#opts = opts
        this.files = [opts.location]
    }

    fromSaveItem = (sitem: SaveItem) => {
        const item: Item = {
            translations: new Map(),
            urlAdapters: sitem.urlAdapters ?? [],
            context: sitem.context,
            references:
                sitem?.references?.map(ref => {
                    let refs: (FileRefEntry | null)[] = []
                    if ('links' in ref) {
                        refs = ref.links?.map(link => ({ link, placeholders: [] })) ?? [null]
                    } else if ('refs' in ref) {
                        refs = ref.refs.map(r => ({
                            link: r.link,
                            placeholders: Object.entries(r.placeholders).map(([i, v]) => [i, v]),
                        }))
                    } else {
                        refs = [null]
                    }
                    return { file: ref.file, refs }
                }) ?? [],
        }
        for (const loc of this.#opts.locales) {
            let str: string | string[] | undefined
            if (this.#opts.flattenTranslations) {
                str = sitem[loc] as string | string[]
            } else {
                str = sitem.translations?.[loc]
            }
            if (str == null) {
                continue // filled at main handler
            }
            item.translations.set(loc, str)
        }
        if (this.#opts.mergeSameRegionals) {
            for (const loc of this.#opts.locales) {
                const [base, region] = loc.split('-')
                if (!region || item.translations.has(loc)) {
                    continue
                }
                const baseTransl = item.translations.get(base!)
                if (baseTransl) {
                    item.translations.set(loc, baseTransl)
                }
            }
        }
        return item
    }

    loadRaw = async (filename: string) => {
        const content = await this.#opts.fs.read(filename)
        if (content == null || !content.trim()) {
            return []
        }
        return this.#opts.parse(content).map(this.fromSaveItem)
    }

    load = () => this.loadRaw(this.files[0])

    saveRaw = async (filename: string, items: SaveItem[]) => {
        if (items.length === 0) {
            await this.#opts.fs.unlink(filename)
            return
        }
        await this.#opts.fs.write(filename, this.#opts.stringify(items as SaveItem[], null, '  '))
    }

    toSaveItem = (item: Item): SaveItem => {
        const translations: [string, string | string[]][] = []
        for (const loc of this.#opts.locales) {
            translations.push([loc, item.translations.get(loc)!])
        }
        const saveItem: SaveItem = {
            context: item.context,
            urlAdapters: item.urlAdapters,
            references: [],
        }
        let translationsForMerge: Record<string, unknown>
        if (this.#opts.flattenTranslations) {
            for (const [loc, transl] of translations) {
                saveItem[loc] = transl
            }
            translationsForMerge = saveItem
        } else {
            saveItem.translations = Object.fromEntries(translations)
            translationsForMerge = saveItem.translations
        }
        if (this.#opts.mergeSameRegionals) {
            for (const loc of this.#opts.locales) {
                const [base, reg] = loc.split('-')
                if (!reg) {
                    continue
                }
                const tLoc = translationsForMerge[loc] as string | string[]
                const tBase = translationsForMerge[base!] as string | string[]
                if (!tLoc || !tBase) {
                    continue
                }
                if (
                    tLoc === tBase ||
                    (typeof tLoc !== 'string' &&
                        typeof tBase !== 'string' &&
                        tLoc.length === tBase.length &&
                        !tLoc.some((t, i) => t !== tBase[i]))
                ) {
                    delete translationsForMerge[loc]
                }
            }
        }
        if (this.#opts.removePlaceholders) {
            saveItem.references = item.references.map(ref => {
                const nref: SaveRefMin = {
                    file: ref.file,
                    links: ref.refs.map(r => r?.link).filter(l => l != null),
                }
                if (!nref.links?.length) {
                    delete nref.links
                }
                return nref
            })
        } else {
            saveItem.references = item.references.map(ref => {
                const nref: SaveRefFull = {
                    file: ref.file,
                    refs: ref.refs
                        .filter(r => r != null)
                        .map(r => ({
                            link: r.link,
                            placeholders: Object.fromEntries(r.placeholders ?? []),
                        })),
                }
                if (!nref.refs?.length) {
                    delete nref.refs
                }
                return nref
            })
        }
        if (saveItem.references?.length === 0) {
            delete saveItem.references
        }
        if ((saveItem.urlAdapters as string[])?.length === 0) {
            delete saveItem.urlAdapters
        }
        return saveItem
    }

    save = async (items: Item[]) => {
        await this.saveRaw(
            this.files[0],
            items.map(this.toSaveItem).filter(i => !(i.urlAdapters as string[])?.length),
        )
    }
}

export function json(jsonOpts: Partial<JSONOpts> = {}): StorageFactory {
    return async opts => {
        const defaultLocation = resolve(opts.root, opts.localesDir, 'catalog.json')
        const fullOpts = fillDefaults(jsonOpts, { ...defaultOpts, location: defaultLocation })
        await opts.fs.mkdir(dirname(resolve(opts.root, fullOpts.location))) // create once
        return new JSONFile({ ...opts, ...fullOpts })
    }
}
