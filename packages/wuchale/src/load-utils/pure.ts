import type { CatalogModule } from "../runtime.js"
import type { LoaderFunc } from "./index.js"

export type CatalogsByID = Record<string, CatalogModule>

/** No-side effect way to load catalogs. Can be used for multiple file IDs. */
export async function loadCatalogs(locale: string, loadIDs: string[], loadCatalog: LoaderFunc): Promise<CatalogsByID> {
    const data: CatalogsByID = {}
    const promises = loadIDs.map(id => loadCatalog(id, locale))
    // merge into one object
    for (const [i, loaded] of (await Promise.all(promises)).entries()) {
        data[loadIDs[i]] = loaded
    }
    return data
}
