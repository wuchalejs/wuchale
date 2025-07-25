import { type CatalogModule, Runtime } from './runtime.js'

export type LoaderFunc = (loadID: string, locale: string) => CatalogModule | Promise<CatalogModule>

type LoadedRTByID = {[loadID: string]: Runtime}
export type LoaderState = {catalogs: LoadedRTByID, load: LoaderFunc}

/** Global catalog states registry */
const states: {[key: string]: LoaderState} = {}

/**
 * - `key` is a unique identifier for the group
 * - `loadIDs` and `load` MUST be imported from the loader virtual modules or proxies.
*/
export function registerLoaders(key: string, load: LoaderFunc, loadIDs: string[], catalogs?: LoadedRTByID): (fileID: string) => Runtime {
    if (!(key in states)) {
        states[key] = {load, catalogs: catalogs ?? {}}
    }
    for (const id of loadIDs) {
        states[key].catalogs[id] = new Runtime()
    }
    return loadID => states[key].catalogs[loadID] ?? new Runtime()
}

/** 
 * Loads catalogs using registered loaders.
 * Can be called anywhere you want to set the locale.
*/
export async function loadLocale(locale: string, key?: string): Promise<LoadedRTByID> {
    const data: LoadedRTByID = {}
    let statesToLoad: LoaderState[]
    if (key) {
        statesToLoad = [states[key]]
    } else {
        statesToLoad = Object.values(states)
    }
    const promises: Promise<CatalogModule>[] = []
    const runtimes: Runtime[] = []
    for (const {catalogs, load} of statesToLoad) {
        for (const [loadID, runtime] of Object.entries(catalogs)) {
            promises.push(<Promise<CatalogModule>>load(loadID, locale))
            runtimes.push(runtime)
        }
    }
    for (const [i, loaded] of (await Promise.all(promises)).entries()) {
        const rt = runtimes[i]
        rt.data = loaded.data
        rt.pr = loaded.plural
    }
    return data
}

/** No-side effect way to load catalogs. Can be used for multiple file IDs. */
export async function loadCatalogs(locale: string, loadIDs: string[], loadCatalog: LoaderFunc): Promise<LoadedRTByID> {
    const data: LoadedRTByID = {}
    const promises = loadIDs.map(id => loadCatalog(id, locale))
    // merge into one object
    for (const [i, loaded] of (await Promise.all(promises)).entries()) {
        data[loadIDs[i]] = new Runtime(loaded)
    }
    return data
}
