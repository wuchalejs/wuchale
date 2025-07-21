import { type CatalogModule, Runtime } from './runtime.js'

type LoaderFunc = (locale: string) => CatalogModule | Promise<CatalogModule>
type LoaderState = {
    current: Runtime
}

/** per-group states synchronizer */
export class PerFileAsyncReg {

    locale: string | null = null
    states: {[fileID: string]: {state: LoaderState, load: LoaderFunc}} = {}

    async registerLoader(fileID: string, state: LoaderState, load: LoaderFunc) {
        if (fileID in this.states) {
            state.current = this.states[fileID].state.current
            return
        }
        this.states[fileID] = {state, load}
        if (!this.locale) {
            return
        }
        state.current = new Runtime(await load(this.locale))
    }

    async setLocale(locale: string) {
        for (const statesVal of Object.values(this.states)) {
            statesVal.state.current = new Runtime(await statesVal.load(locale))
        }
        this.locale = locale
    }
}

/** Global catalog states registry */
const states: {[key: string]: PerFileAsyncReg} = {}

/** Should be called inside your loader file.
 * - `key` is a unique identifier for the group
 * - `fileID` MUST be imported from the loader virtual modules if you use per file loading. If not, it can be anything.
*/
export function registerLoader(key: string, fileID: string, state: LoaderState, load: LoaderFunc): () => Runtime {
    if (!(key in states)) {
        states[key] = new PerFileAsyncReg()
    }
    states[key].registerLoader(fileID, state, load)
    return () => states[key].states[fileID].state.current
}

/** Can be called anywhere you want to set the locale */
export async function setLocale(locale: string, key?: string) {
    if (key) {
        return await states[key]?.setLocale(locale)
    }
    await Promise.all(Object.values(states).map(s => s.setLocale(locale)))
}
