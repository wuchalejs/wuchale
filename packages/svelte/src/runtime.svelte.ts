import { Runtime, _wre_, type CatalogModule } from "wuchale/runtime"

export let _wrs_: (key: string) => Runtime

const dataCollection: {[key: string]: Runtime} = $state({})

// no $app/environment.browser because it must work without sveltekit
if (globalThis.window) {
    _wrs_ = key => dataCollection[key] ?? fallback
} else {
    _wrs_ = _wre_
}

const fallback = new Runtime()

export function setCatalog(mod: CatalogModule) {
    dataCollection[mod.key] = new Runtime(mod)
}
