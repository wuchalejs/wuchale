import pm from 'picomatch'
import { getKey, IndexTracker, type LoadGroupPatt } from '../adapters.js'
import type { CompiledElement } from '../compile.js'
import { type Catalog, type CatalogStorage, fillTranslations, itemIsObsolete } from '../storage.js'

export type CompiledCatalogs = Map<string, CompiledElement[]>

/** shared states among multiple adapters handlers */
export class SharedState {
    ownerKey: string
    sourceLocale: string
    compiled: CompiledCatalogs = new Map()
    indexTracker: IndexTracker

    // storage
    storage: CatalogStorage
    catalog: Catalog = new Map()

    constructor(storage: CatalogStorage, ownerKey: string, sourceLocale: string, allowNewItems: boolean) {
        this.ownerKey = ownerKey
        this.sourceLocale = sourceLocale
        this.storage = storage
        this.indexTracker = new IndexTracker(allowNewItems)
    }

    async load(locales: string[]) {
        for (const item of await this.storage.load()) {
            fillTranslations(item, locales)
            const id = item.translations.get(this.sourceLocale)!
            this.catalog.set(getKey(id, item.context), item)
        }
    }

    async save(onlyReferenced: boolean) {
        const items = Array.from(this.catalog.values())
        await this.storage.save(onlyReferenced ? items.filter(i => !itemIsObsolete(i)) : items)
    }
}

export type GranularState = {
    id: number
    compiled: CompiledCatalogs
    indexTracker: IndexTracker
}

export type WriteProxies = (groupPatterns: LoadGroupPatt[]) => Promise<void>

export class State {
    #byFile: Map<string, GranularState> = new Map()
    readonly byID: Map<number, GranularState> = new Map()

    #writeProxies: WriteProxies
    readonly groupPatterns: LoadGroupPatt[] = []
    #groupMatches: ((f: string) => boolean)[] = []

    constructor(writeProxies: WriteProxies, groupPatterns: LoadGroupPatt[]) {
        this.#writeProxies = writeProxies
        this.groupPatterns = groupPatterns
        this.#groupMatches = groupPatterns.map(p => pm(p))
    }

    #getLoadID(filename: string) {
        let id = -1
        for (const [i, match] of this.#groupMatches.entries()) {
            if (!match(filename)) {
                continue
            }
            id = i
        }
        if (id === -1) {
            id = this.groupPatterns.length
            this.groupPatterns.push(filename)
            this.#groupMatches.push(f => f === filename)
        }
        return id + 1 // not to start from 0 which is reserved for the shared
    }

    async byFileCreate(filename: string, locales: string[], allowNewItems: boolean): Promise<GranularState> {
        let state = this.#byFile.get(filename)
        if (state != null) {
            return state
        }
        const id = this.#getLoadID(filename)
        state = this.byID.get(id)
        if (!state) {
            state = {
                id,
                compiled: new Map(),
                indexTracker: new IndexTracker(allowNewItems),
            }
            for (const loc of locales) {
                state.compiled.set(loc, [])
            }
            this.byID.set(id, state)
            await this.#writeProxies(this.groupPatterns)
        }
        this.#byFile.set(filename, state)
        return state
    }
}
