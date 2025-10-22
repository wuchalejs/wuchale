import toRuntime, { type CatalogModule, type Runtime } from '../runtime.js'

export type LoaderFunc = (loadID: string, locale: string) => CatalogModule | Promise<CatalogModule>

export type RuntimeCollection = {
    get: (loadID: string) => Runtime
    set: (loadID: string, catalog: Runtime) => void
}

export type LoaderState = {
    load: LoaderFunc
    loadIDs: string[]
    collection: RuntimeCollection
}

export function defaultCollection(store: Record<string, Runtime>): RuntimeCollection {
    return {
        get: loadID => store[loadID],
        set: (loadID, rt) => {
            store[loadID] = rt
        }
    }
}

/** Global catalog states registry */
const states: Record<string, LoaderState> = {}
const emptyRuntime = toRuntime()

/**
 * - `key` is a unique identifier for the group
 * - `loadIDs` and `load` MUST be imported from the loader virtual modules or proxies.
*/
export function registerLoaders(key: string, load: LoaderFunc, loadIDs: string[], collection?: RuntimeCollection): (fileID: string) => Runtime {
    states[key] = { load, loadIDs, collection: collection ?? defaultCollection({}) }
    for (const id of loadIDs) {
        states[key].collection.set(id, emptyRuntime)
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
            promises.push(state.load(loadID, locale) as Promise<CatalogModule>)
            statesArr.push([loadID, state])
        }
    }
    for (const [i, loaded] of (await Promise.all(promises)).entries()) {
        const [loadID, state] = statesArr[i]
        state.collection.set(loadID, toRuntime(loaded, locale))
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
            const loaded = state.load(loadID, locale) as CatalogModule
            state.collection.set(loadID, toRuntime(loaded, locale))
        }
    }
}
