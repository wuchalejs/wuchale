import { AsyncLocalStorage } from 'node:async_hooks'
import { Runtime, type CatalogModule } from './runtime.js'

type LoaderFunc = (locale: string) => CatalogModule | Promise<CatalogModule>

const catalogCtx: AsyncLocalStorage<{[key: string]: Runtime}> = new AsyncLocalStorage()

const catalogModuleLoaders: { [key: string]: LoaderFunc } = {}

export function registerLoader(key: string, load: LoaderFunc): () => Runtime {
    catalogModuleLoaders[key] = load
    return () => catalogCtx.getStore()[key] ?? new Runtime()
}

export async function runWithLocale<T>(locale: string, func: () => T | Promise<T>): Promise<T> {
    const catalogs: {[key: string]: Runtime} = {}
    for (const [key, load] of Object.entries(catalogModuleLoaders)) {
        catalogs[key] = new Runtime(await load(locale))
    }
    return await catalogCtx.run(catalogs, func)
}
