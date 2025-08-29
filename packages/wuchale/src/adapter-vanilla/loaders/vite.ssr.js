// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { loadCatalog, loadIDs, key } from 'virtual:wuchale/proxy/sync' // because it's on the server
import { currentCatalog } from 'wuchale/load-utils/server'

export { loadCatalog, loadIDs, key } // for loading before runWithLocale

// two exports, same function
export const get = (/** @type {string} */ loadID) => currentCatalog(key, loadID)
export default get
