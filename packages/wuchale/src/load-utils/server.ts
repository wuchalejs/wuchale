import type { LoaderFunc } from './index.js'
import toRuntime, { type Runtime } from '../runtime.js'
import { AsyncLocalStorage } from 'node:async_hooks'

// by key, by loadID
type LoadedRuntimes = Record<string, Record<string, Runtime>>
// by locale
const runtimes: Record<string, LoadedRuntimes> = {}
// exported mainly for stackblitz examples polyfills
export const runtimeCtx: AsyncLocalStorage<LoadedRuntimes> = new AsyncLocalStorage()
const emptyRuntime = toRuntime()

let warningShown = {}

export function currentRuntime(key: string, loadID: string) {
    const runtime = runtimeCtx.getStore()?.[key]?.[loadID]
    if (runtime != null) {
        return runtime
    }
    const warnKey = `${key}.${loadID}`
    if (warningShown[warnKey]) {
        return emptyRuntime
    }
    console.warn(`Catalog for '${warnKey}' not found.\n  Either 'runWithLocale' was not called or the environment has a problem.`)
    warningShown[warnKey] = true
    return emptyRuntime
}

export async function loadLocales(key: string, loadIDs: string[], load: LoaderFunc, locales: string[]): Promise<(loadID: string) => Runtime> {
    if (loadIDs == null) {
        loadIDs = [key]
    }
    for (const locale of locales) {
        if (!(locale in runtimes)) {
            runtimes[locale] = {}
        }
        const loaded = runtimes[locale]
        if (!(key in loaded)) {
            loaded[key] = {}
        }
        for (const id of loadIDs) {
            loaded[key][id] = toRuntime(await load(id, locale), locale)
        }
    }
    return (loadID: string) => currentRuntime(key, loadID)
}

export async function runWithLocale<T>(locale: string, func: () => T): Promise<T> {
    return await runtimeCtx.run(runtimes[locale], func)
}
