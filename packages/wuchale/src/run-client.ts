import { type CatalogModule, defaultPluralsRule, Runtime } from './runtime.js'

export type LoaderFunc = (loadID: string, locale: string) => CatalogModule | Promise<CatalogModule>

type CatalogsByID = {[loadID: string]: CatalogModule}
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
        states[key].catalogs[id] = {data: [], plural: defaultPluralsRule}
    }
    return loadID => new Runtime(states[key].catalogs[loadID])
}

/** 
 * Loads catalogs using registered loaders.
 * Can be called anywhere you want to set the locale.
*/
export async function loadLocale(locale: string, key?: string): Promise<CatalogsByID> {
    const data: CatalogsByID = {}
    let statesToLoad: LoaderState[]
    if (key) {
        statesToLoad = [states[key]]
    } else {
        statesToLoad = Object.values(states)
    }
    const promises: Promise<CatalogModule>[] = []
    const catalogsArr: CatalogModule[] = []
    for (const {catalogs, load} of statesToLoad) {
        for (const [loadID, catalog] of Object.entries(catalogs)) {
            promises.push(<Promise<CatalogModule>>load(loadID, locale))
            catalogsArr.push(catalog)
        }
    }
    for (const [i, loaded] of (await Promise.all(promises)).entries()) {
        const rt = catalogsArr[i]
        rt.data = loaded.data
        rt.plural = loaded.plural
    }
    return data
}

/** No-side effect way to load catalogs. Can be used for multiple file IDs. */
export async function loadCatalogs(locale: string, loadIDs: string[], loadCatalog: LoaderFunc): Promise<CatalogsByID> {
    const data: CatalogsByID = {}
    const promises = loadIDs.map(id => loadCatalog(id, locale))
    // merge into one object
    for (const [i, loaded] of (await Promise.all(promises)).entries()) {
        data[loadIDs[i]] = loaded
    }
    return data
}
