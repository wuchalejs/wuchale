import type { CatalogModule } from '../runtime.js'

export type LoaderFunc = (loadID: string, locale: string) => CatalogModule | Promise<CatalogModule>

export type CatalogCollection = {
    get: (loadID: string) => CatalogModule
    set: (loadID: string, catalog: CatalogModule) => void
}

export type LoaderState = {
    load: LoaderFunc
    loadIDs: string[]
    collection: CatalogCollection
}

export function defaultCollection(store: Record<string, CatalogModule>): CatalogCollection {
    return {
        get: loadID => store[loadID],
        set: (loadID, catalog) => {
            if (loadID in store) {
                Object.assign(store[loadID], catalog)
            } else {
                store[loadID] = catalog
            }
        }
    }
}

/** Global catalog states registry */
const states: Record<string, LoaderState> = {}
const emptyCatalog: CatalogModule = { c: [] }

/**
 * - `key` is a unique identifier for the group
 * - `loadIDs` and `load` MUST be imported from the loader virtual modules or proxies.
*/
export function registerLoaders(key: string, load: LoaderFunc, loadIDs: string[], collection?: CatalogCollection): (fileID: string) => CatalogModule {
    if (!(key in states)) {
        states[key] = { load, loadIDs, collection: collection ?? defaultCollection({}) }
        // @ts-expect-error
    } else if (import.meta.env?.DEV) { // stripped from prod builds
        // for when doing HMR for loader file
        for (const id of loadIDs) {
            collection.set(id, states[key].collection.get(id) ?? emptyCatalog)
        }
        states[key].collection = collection
        return loadID => collection.get(loadID)
    }
    for (const id of loadIDs) {
        states[key].collection.set(id, emptyCatalog)
    }
    return loadID => states[key].collection.get(loadID)
}

function statesToLoad(key?: string): LoaderState[] {
    if (key) {
        return [states[key]]
    }
    return Object.values(states)
}

/** 
 * Loads catalogs using registered async loaders.
 * Can be called anywhere you want to set the locale.
*/
export async function loadLocale(locale: string, key?: string): Promise<void> {
    const promises: Promise<CatalogModule>[] = []
    const statesArr: [string, LoaderState][] = []
    for (const state of statesToLoad(key)) {
        for (const loadID of state.loadIDs) {
            promises.push(<Promise<CatalogModule>>state.load(loadID, locale))
            statesArr.push([loadID, state])
        }
    }
    for (const [i, loaded] of (await Promise.all(promises)).entries()) {
        const [loadID, state] = statesArr[i]
        state.collection.set(loadID, {...loaded})
    }
}

/** 
 * Loads catalogs using registered sync loaders.
 * Can be called anywhere you want to set the locale.
 * The loadCatalog function should be from a sync proxy.
*/
export function loadLocaleSync(locale: string, key?: string) {
    for (const state of statesToLoad(key)) {
        for (const loadID of state.loadIDs) {
            const loaded = <CatalogModule>state.load(loadID, locale)
            state.collection.set(loadID, loaded)
        }
    }
}
