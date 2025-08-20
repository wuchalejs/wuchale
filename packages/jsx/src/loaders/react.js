// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { loadCatalog, loadIDs, key } from 'virtual:wuchale/proxy' // or proxy/sync
import { registerLoaders } from 'wuchale/load-utils'
import { useState, useEffect } from 'react'

const callbacks = {}

const collection = {
    get: () => null, // not needed, using useState
    set: (/** @type {string} */ loadID, /** @type {import('wuchale/runtime').CatalogModule} */ catalog) => {
        callbacks[loadID]?.(catalog)
    }
}

registerLoaders(key, loadCatalog, loadIDs, collection)

/**
 * @param { string } loadID
 */
export default loadID => {
    const [catalog, setCatalog] = useState(null)
    useEffect(() => {
        callbacks[loadID] = (/** @type {import('wuchale/runtime').CatalogModule} */ catalog) => setCatalog(catalog)
    })
    return catalog
}
