import type { LoaderFunc } from './run-client.js'
import { Runtime } from './runtime.js'
import { AsyncLocalStorage } from 'node:async_hooks'

type LoadedCatalogs = { [key: string]: {[loadID: string]: Runtime} }
const catalogs: {[locale: string]: LoadedCatalogs } = {}
const catalogCtx: AsyncLocalStorage<LoadedCatalogs> = new AsyncLocalStorage()

export async function loadLocales(key: string, loadIDs: string[], load: LoaderFunc, locales: string[]): Promise<(loadID: string) => Runtime> {
    if (loadIDs == null) {
        loadIDs = [key]
    }
    for (const locale of locales) {
        if (!(locale in catalogs)) {
            catalogs[locale] = {}
        }
        const loaded = catalogs[locale]
        if (!(key in loaded)) {
            loaded[key] = {}
        }
        for (const id of loadIDs) {
            loaded[key][id] = new Runtime(await load(id, locale))
        }
    }
    return (loadID: string) => catalogCtx.getStore()?.[key]?.[loadID] ?? new Runtime()
}

export async function runWithLocale<T>(locale: string, func: () => T): Promise<T> {
    return await catalogCtx.run(catalogs[locale], func)
}
