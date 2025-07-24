// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { loadCatalog, fileIDs } from 'virtual:wuchale/loader' // or /loader/sync
import { page } from '$app/state'
import { Runtime } from 'wuchale/runtime'

export {fileIDs, loadCatalog}

export default (/** @type {string} */ fileID) => {
    return page.data.catalogs?.[fileID] ?? new Runtime()
}
