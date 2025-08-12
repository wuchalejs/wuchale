import { Runtime } from "../runtime.js"
import type { LoaderFunc } from "./client.js"

export type RuntimesByID = Record<string, Runtime>

/** No-side effect way to load catalogs. Can be used for multiple file IDs. */
export async function loadCatalogs(locale: string, loadIDs: string[], loadCatalog: LoaderFunc): Promise<RuntimesByID> {
    const data: RuntimesByID = {}
    const promises = loadIDs.map(id => loadCatalog(id, locale))
    // merge into one object
    for (const [i, loaded] of (await Promise.all(promises)).entries()) {
        data[loadIDs[i]] = new Runtime(loaded)
    }
    return data
}
