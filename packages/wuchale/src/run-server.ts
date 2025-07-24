import { AsyncLocalStorage } from 'node:async_hooks'
import type { LoaderFunc } from './run-client.js'
import { Runtime, type CatalogModule } from './runtime.js'

const catalogCtx: AsyncLocalStorage<{[key: string]: Runtime}> = new AsyncLocalStorage()

const catalogModuleLoaders: { [key: string]: LoaderFunc } = {}

export function registerLoader(key: string, load: LoaderFunc): () => Runtime {
    catalogModuleLoaders[key] = load
    return () => catalogCtx.getStore()[key] ?? new Runtime()
}

export async function runWithLocale<T>(locale: string, func: () => T): Promise<T> {
    const catalogs: {[key: string]: Runtime} = {}
    const promises: [string, CatalogModule | Promise<CatalogModule>][] = []
    for (const [key, load] of Object.entries(catalogModuleLoaders)) {
        promises.push([key, load(key, locale)])
    }
    for (const [key, loaded] of (await Promise.all(promises))) {
        catalogs[key] = new Runtime(<CatalogModule>loaded)
    }
    return await catalogCtx.run(catalogs, func)
}

export const _w_rt_ = (key: string) => catalogCtx.getStore()?.[key] ?? new Runtime()
