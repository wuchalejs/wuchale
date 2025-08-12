// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { loadCatalog, loadIDs } from 'virtual:wuchale/proxy' // or /proxy/sync
import { page } from '$app/state'
import { Runtime } from 'wuchale/runtime'

export { loadIDs, loadCatalog }

export default (/** @type {string} */ loadID) => {
    return page.data.catalogs?.[loadID] ?? new Runtime()
}
