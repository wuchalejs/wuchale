// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

export { loadCatalog, loadIDs, key } from 'virtual:wuchale/proxy'
import { key } from 'virtual:wuchale/proxy'
import { page } from '$app/state'
import { Runtime } from 'wuchale/runtime'

// for server to be set from hooks.server.js
let loadC = (/** @type {string} */ loadID) => {
    return page.data.catalogs?.[loadID] ?? new Runtime()
}

if (import.meta.env.SSR) {
    const { currentRT } = await import('wuchale/load-utils/server')
    loadC = loadID => currentRT(key, loadID)
}

/**
 * @param {string} loadID
 */
export default loadC
