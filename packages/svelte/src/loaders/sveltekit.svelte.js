// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { loadCatalog, loadIDs, key } from 'virtual:wuchale/proxy' // or proxy/sync
import { registerLoaders, defaultCollection } from 'wuchale/load-utils'

export { loadCatalog, loadIDs, key } // for +layout.{js,ts} and hooks.server.{js,ts}

// for non-reactive
/** @type {Function} */
export let get

if (import.meta.env.SSR) { // stripped from production client builds
    const { currentCatalog } = await import('wuchale/load-utils/server')
    get = (/** @type {string} */ loadID) => currentCatalog(key, loadID)
} else { // client
    const catalogs = $state({})
    get = registerLoaders(key, loadCatalog, loadIDs, defaultCollection(catalogs))
}

// same function, only will be inside $derived when used
export default get
