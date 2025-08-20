// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { loadCatalog, loadIDs, key } from 'virtual:wuchale/proxy' // or proxy/sync
import { registerLoaders, defaultCollection } from 'wuchale/load-utils'

export { loadCatalog, loadIDs, key } // for +layout.{js,ts} and hooks.server.{js,ts}

let loadC

if (import.meta.env.SSR) { // stripped from production client builds
    const { currentCatalog } = await import('wuchale/load-utils/server')
    loadC = (/** @type {string} */ loadID) => currentCatalog(key, loadID)
} else { // client
    const catalogs = $state({})
    loadC = registerLoaders(key, loadCatalog, loadIDs, defaultCollection(catalogs))
}

export default loadC
