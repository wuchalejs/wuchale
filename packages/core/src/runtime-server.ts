import { AsyncLocalStorage } from 'node:async_hooks'
import { Runtime, type CatalogModule } from './runtime.js'

const dataCollection: AsyncLocalStorage<CatalogModule> = new AsyncLocalStorage()

/** This is a concurrency safe usage for tasks on a server that processes requests from multiple clients */
export function runWithCatalog<Type> (mod: CatalogModule, callback: () => Type) {
    return dataCollection.run(mod, callback)
}

export const _wre_ = () => new Runtime(dataCollection.getStore())
