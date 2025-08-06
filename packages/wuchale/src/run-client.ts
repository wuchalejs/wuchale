import { type CatalogModule, defaultPluralsRule, Runtime } from './runtime.js'

export type LoaderFunc = (loadID: string, locale: string) => CatalogModule | Promise<CatalogModule>

type CatalogsByID = {[loadID: string]: CatalogModule}
type RuntimesByID = {[loadID: string]: Runtime}

export type LoaderState = {catalogs: CatalogsByID, load: LoaderFunc}

/** Global catalog states registry */
const states: {[key: string]: LoaderState} = {}

/**
 * - `key` is a unique identifier for the group
 * - `loadIDs` and `load` MUST be imported from the loader virtual modules or proxies.
*/
export function registerLoaders(key: string, load: LoaderFunc, loadIDs: string[], catalogs?: CatalogsByID): (fileID: string) => Runtime {
    if (!(key in states)) {
        states[key] = {load, catalogs: catalogs ?? {}}
    }
    for (const id of loadIDs) {
        states[key].catalogs[id] = {c: [], p: defaultPluralsRule}
    }
    return loadID => new Runtime(states[key].catalogs[loadID])
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
    const catalogsArr: CatalogModule[] = []
    for (const {catalogs, load} of statesToLoad(key)) {
        for (const [loadID, catalog] of Object.entries(catalogs)) {
            promises.push(<Promise<CatalogModule>>load(loadID, locale))
            catalogsArr.push(catalog)
        }
    }
    for (const [i, loaded] of (await Promise.all(promises)).entries()) {
        const prev = catalogsArr[i]
        prev.c = loaded.c
        prev.p = loaded.p
    }
}

/** 
 * Loads catalogs using registered sync loaders.
 * Can be called anywhere you want to set the locale.
 * The loadCatalog function should be from a sync proxy.
*/
export function loadLocaleSync(locale: string, key?: string) {
    for (const {catalogs, load} of statesToLoad(key)) {
        for (const [loadID, prev] of Object.entries(catalogs)) {
            const loaded = <CatalogModule>load(loadID, locale)
            prev.c = loaded.c
            prev.p = loaded.p
        }
    }
}

/** No-side effect way to load catalogs. Can be used for multiple file IDs. */
export async function loadCatalogs(locale: string, loadIDs: string[], loadCatalog: LoaderFunc): Promise<RuntimesByID> {
    const data: RuntimesByID = {}
    const promises = loadIDs.map(id => loadCatalog(id, locale))
    // merge into one object
    for (const [i, loaded] of (await Promise.all(promises)).entries()) {
        data[loadIDs[i]] = new Runtime(loaded)
    }
    return data
}
