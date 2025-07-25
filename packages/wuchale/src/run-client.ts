import { type CatalogModule, Runtime } from './runtime.js'

export type LoaderFunc = (loadID: string, locale: string) => CatalogModule | Promise<CatalogModule>
export type LoaderState = {[loadID: string]: {catalog: Runtime, load: LoaderFunc}}

type LoadedRTByFile = {[loadID: string]: Runtime}

/** per-group states synchronizer */
export class PerFileAsyncReg {

    locale: string | null = null
    defaultState: LoaderState = {}

    async registerLoader(loadID: string, load: LoaderFunc, state?: LoaderState) {
        if (!state) {
            state = this.defaultState
        } else {
            this.defaultState = state
        }
        if (loadID in state) {
            return
        }
        state[loadID] = {catalog: new Runtime(), load}
        if (this.locale) {
            state[loadID].catalog = new Runtime(await load(loadID, this.locale))
            return
        }
    }

    async loadLocale(locale: string): Promise<LoadedRTByFile> {
        const data: LoadedRTByFile = {}
        const promises = []
        const entries = Object.entries(this.defaultState)
        for (const [loadID, statesVal] of entries) {
            promises.push(statesVal.load(loadID, locale))
        }
        for (const [i, loaded] of (await Promise.all(promises)).entries()) {
            const [loadID, statesVal] = entries[i]
            statesVal.catalog = new Runtime(loaded)
            data[loadID] = statesVal.catalog
        }
        this.locale = locale
        return data
    }
}

/** Global catalog states registry */
const states: {[key: string]: PerFileAsyncReg} = {}

/**
 * - `key` is a unique identifier for the group
 * - `loadIDs` and `load` MUST be imported from the loader virtual modules.
*/
export function registerLoader(key: string, load: LoaderFunc, loadIDs: string[], state?: LoaderState): (fileID: string) => Runtime {
    if (!(key in states)) {
        states[key] = new PerFileAsyncReg()
    }
    for (const id of loadIDs) {
        states[key].registerLoader(id, load, state)
    }
    return loadID => state[loadID].catalog ?? new Runtime()
}

/** 
 * Loads catalogs using registered loaders.
 * Can be called anywhere you want to set the locale.
*/
export async function loadLocale(locale: string, key?: string): Promise<LoadedRTByFile> {
    const data: LoadedRTByFile = {}
    let promises: Promise<LoadedRTByFile>[]
    if (key) {
        promises = [states[key].loadLocale(locale)]
    } else {
        promises = Object.values(states).map(s => s.loadLocale(locale))
    }
    // merge into one object
    for (const set of await Promise.all(promises)) {
        Object.assign(data, set)
    }
    return data
}

/** No-side effect way to load catalogs. Can be used for multiple file IDs. */
export async function loadCatalogs(locale: string, loadIDs: string[], loadCatalog: LoaderFunc): Promise<LoadedRTByFile> {
    const data: LoadedRTByFile = {}
    const promises = loadIDs.map(id => loadCatalog(id, locale))
    // merge into one object
    for (const [i, loaded] of (await Promise.all(promises)).entries()) {
        data[loadIDs[i]] = new Runtime(loaded)
    }
    return data
}
