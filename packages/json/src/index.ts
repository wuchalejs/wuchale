import { resolve } from 'node:path'
import {
    type FileRefEntry,
    fillDefaults,
    type Item,
    type PluralRule,
    type PluralRules,
    type SaveData,
    type StorageFactory,
    type StorageFactoryOpts,
} from 'wuchale'

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

type SaveDataCustom = {
    items: SaveItem[]
    pluralRules: Record<string, PluralRule>
}

type JSONOpts = {
    dir: string
    extension: string
    mergeSameRegionals: boolean
    removePluralRule: boolean
    removePlaceholders: boolean
    flattenTranslations: boolean
    stringForSingle: boolean
    parse: typeof JSON.parse
    stringify: typeof JSON.stringify
}

const defaultOpts: JSONOpts = {
    dir: 'src/locales',
    extension: 'json',
    mergeSameRegionals: false,
    removePluralRule: false,
    removePlaceholders: false,
    flattenTranslations: false,
    stringForSingle: false,
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
                            placeholders: Object.entries(r.placeholders).map(([i, v]) => [Number(i), v]),
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
            item.translations.set(loc, typeof str === 'string' ? [str] : (str as string[]))
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
        if (content === null) {
            return {}
        }
        let savedItems: SaveItem[]
        let pluralRules: PluralRules | undefined
        let parsed: SaveItem[] | SaveDataCustom
        try {
            parsed = this.#opts.parse(content)
        } catch {
            return {}
        }
        if (this.#opts.removePluralRule) {
            savedItems = parsed as SaveItem[]
        } else {
            const data = parsed as SaveDataCustom
            savedItems = data.items
            pluralRules = new Map(Object.entries(data.pluralRules ?? {}))
        }
        return { items: savedItems.map(this.fromSaveItem), pluralRules }
    }

    load = async () => {
        let { items, pluralRules } = await this.loadRaw(this.files[0])
        if (this.#opts.haveUrl) {
            items = [...((await this.loadRaw(this.files[1])).items ?? []), ...(items ?? [])]
        } else {
            items = items ?? []
        }
        return { items, pluralRules }
    }

    saveRaw = async (filename: string, items: SaveItem[], pluralRules: PluralRules) => {
        if (items.length === 0) {
            await this.#opts.fs.unlink(filename)
            return
        }
        let data: SaveItem[] | SaveDataCustom
        if (this.#opts.removePluralRule) {
            data = items
        } else {
            data = { pluralRules: Object.fromEntries(pluralRules.entries()), items } as SaveDataCustom
        }
        await this.#opts.fs.write(filename, this.#opts.stringify(data, null, '  '))
    }

    toSaveItem = (item: Item): SaveItem => {
        let translations: [string, string | string[]][] = Array.from(item.translations)
        if (this.#opts.stringForSingle) {
            translations = translations.map(([k, t]) => [k, t.length === 1 ? t[0]! : t])
        }
        const saveItem: SaveItem = {
            context: item.context,
            urlAdapters: item.urlAdapters,
            references: [],
        }
        if (this.#opts.flattenTranslations) {
            for (const [loc, transl] of translations) {
                saveItem[loc] = transl
            }
        } else {
            saveItem.translations = Object.fromEntries(translations)
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
        if (this.#opts.mergeSameRegionals) {
            for (const loc of this.#opts.locales) {
                const [base, reg] = loc.split('-')
                if (!reg) {
                    continue
                }
                const tLoc = saveItem[loc] as string[]
                const tBase = saveItem[base!] as string[]
                if (tLoc === tBase || Array.from(tLoc).join('') === Array.from(tBase).join('')) {
                    delete saveItem[loc]
                }
            }
        }
        if (saveItem.references?.length === 0) {
            delete saveItem.references
        }
        if ((saveItem.urlAdapters as string[])?.length === 0) {
            delete saveItem.urlAdapters
        }
        return saveItem
    }

    save = async (data: SaveData) => {
        const items = data.items.map(this.toSaveItem)
        await this.saveRaw(
            this.files[0],
            items.filter(i => !(i.urlAdapters as string[])?.length),
            data.pluralRules,
        )
        await this.saveRaw(
            this.files[1],
            items.filter(i => (i.urlAdapters as string[])?.length),
            data.pluralRules,
        )
    }
}

export function json(jsonOpts: Partial<JSONOpts> = {}): StorageFactory {
    return async opts => {
        const fullOpts = fillDefaults(jsonOpts, { ...defaultOpts, dir: opts.localesDir })
        await opts.fs.mkdir(fullOpts.dir)
        return new JSONFile({ ...opts, ...fullOpts })
    }
}
