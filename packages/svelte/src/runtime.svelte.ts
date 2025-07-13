import { Runtime, type CatalogModule } from "wuchale/runtime"

const dataCollection: {[key: string]: Runtime} = $state({})
const fallback = new Runtime()

export function setCatalog(mod: CatalogModule, key: string) {
    dataCollection[key] = new Runtime(mod)
}

export const _wrs_ = (key: string): Runtime => dataCollection[key] ?? fallback
