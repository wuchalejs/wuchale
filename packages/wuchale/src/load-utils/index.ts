import toRuntime, { type CatalogModule, type Runtime } from '../runtime.js'

export type LoaderFunc = (loadID: number, locale: string) => CatalogModule | Promise<CatalogModule>

export type RuntimeCollection = {
    get: (loadID: number) => Runtime
    set: (loadID: number, runtime: Runtime) => void
}

export type LoaderState = {
    load: LoaderFunc
    catalogs: (CatalogModule | undefined)[]
    collection: RuntimeCollection
}

export function defaultCollection(store: Runtime[]): RuntimeCollection {
    return {
        get: loadID => store[loadID]!,
        set: (loadID, rt) => {
            store[loadID] = rt
        },
    }
}

/** Global catalog states registry */
const states: Record<string, LoaderState> = {}
const emptyRuntime = toRuntime()

/**
 * - `key` is a unique identifier for the group
 * - `loadIDs` and `load` MUST be imported from the loader virtual modules or proxies.
 */
export function registerLoaders(
    key: string,
    load: LoaderFunc,
    nLoadIDs: number,
    collection?: RuntimeCollection,
): (loadID?: number) => Runtime {
    states[key] = {
        load,
        catalogs: Array(nLoadIDs).fill(undefined),
        collection: collection ?? defaultCollection([]),
    }
    for (let id = 0; id < nLoadIDs; id++) {
        states[key].collection.set(id, emptyRuntime)
    }
    return (loadID = 0) => states[key]!.collection.get(loadID)
}

/* Sets the most recently loaded locale as the current one */
export function commitLocale(locale: string) {
    for (const state of Object.values(states)) {
        for (const [loadID, catalog] of state.catalogs.entries()) {
            state.collection.set(loadID, toRuntime(catalog, locale))
        }
    }
}

/**
 * Loads catalogs using registered async loaders.
 * Can be called anywhere you want to set the locale.
 * `commit` can be `false` if you want to delay the rendering, use `commitLocale` later
 */
export async function loadLocale(locale: string, commit = true): Promise<void> {
    const promises: Promise<CatalogModule>[] = []
    const statesArr: [number, LoaderState][] = []
    for (const state of Object.values(states)) {
        for (let id = 0; id < state.catalogs.length; id++) {
            promises.push(state.load(id, locale) as Promise<CatalogModule>)
            statesArr.push([id, state])
        }
    }
    for (const [i, loaded] of (await Promise.all(promises)).entries()) {
        const [loadID, state] = statesArr[i]!
        state.catalogs[loadID] = loaded
    }
    commit && commitLocale(locale)
}

/**
 * Loads catalogs using registered sync loaders.
 * Can be called anywhere you want to set the locale.
 * The loadCatalog function should be from a sync proxy.
 * `commit` can be `false` if you want to delay the rendering, use `commitLocale` later
 */
export function loadLocaleSync(locale: string, commit = true) {
    for (const state of Object.values(states)) {
        for (let id = 0; id < state.catalogs.length; id++) {
            state.catalogs[id] = state.load(id, locale) as CatalogModule
        }
    }
    commit && commitLocale(locale)
}
