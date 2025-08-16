import type { LoaderFunc } from './index.js'
import { Runtime, type CatalogModule } from '../runtime.js'
import { AsyncLocalStorage } from 'node:async_hooks'

type LoadedCatalogs = Record<string, Record<string, CatalogModule>>
const catalogs: Record<string, LoadedCatalogs> = {}
const catalogCtx: AsyncLocalStorage<LoadedCatalogs> = new AsyncLocalStorage()

export function currentRT(key: string, loadID: string) {
    return new Runtime(catalogCtx.getStore()[key][loadID])
}

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
            loaded[key][id] = await load(id, locale)
        }
    }
    return (loadID: string) => currentRT(key, loadID)
}

export async function runWithLocale<T>(locale: string, func: () => T): Promise<T> {
    return await catalogCtx.run(catalogs[locale], func)
}
