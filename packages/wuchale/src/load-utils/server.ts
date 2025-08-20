import type { LoaderFunc } from './index.js'
import type { CatalogModule } from '../runtime.js'
import { AsyncLocalStorage } from 'node:async_hooks'

type LoadedCatalogs = Record<string, Record<string, CatalogModule>>
const catalogs: Record<string, LoadedCatalogs> = {}
const catalogCtx: AsyncLocalStorage<LoadedCatalogs> = new AsyncLocalStorage()

export function currentCatalog(key: string, loadID: string) {
    return catalogCtx.getStore()[key][loadID]
}

export async function loadLocales(key: string, loadIDs: string[], load: LoaderFunc, locales: string[]): Promise<(loadID: string) => CatalogModule> {
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
    return (loadID: string) => currentCatalog(key, loadID)
}

export async function runWithLocale<T>(locale: string, func: () => T): Promise<T> {
    return await catalogCtx.run(catalogs[locale], func)
}
