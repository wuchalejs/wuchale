// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { loadCatalog, loadIDs, key } from 'virtual:wuchale/proxy' // or proxy/sync
import { registerLoaders } from 'wuchale/load-utils'
import { useState, useEffect } from 'react'

const callbacks = {}
const store = {}

const collection = {
    get: loadID => store[loadID],
    set: (/** @type {string} */ loadID, /** @type {import('wuchale/runtime').CatalogModule} */ catalog) => {
        store[loadID] = catalog // for when useEffect hasn't run yet
        callbacks[loadID]?.(catalog)
    }
}

registerLoaders(key, loadCatalog, loadIDs, collection)

/**
 * @param { string } loadID
 */
export default loadID => {
    const [catalog, setCatalog] = useState(collection.get(loadID))
    useEffect(() => {
        callbacks[loadID] = (/** @type {import('wuchale/runtime').CatalogModule} */ catalog) => setCatalog(catalog)
    })
    return catalog
}
