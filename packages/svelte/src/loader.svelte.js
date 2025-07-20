// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

// NOTE: if you use-per file loading, HMR for THIS file will not work
// because this file will just be used as a template, not imported directly.
// If you make a change, restart the dev server.

import { Runtime } from 'wuchale/runtime'
import loadCatalog from 'virtual:wuchale/loader' // or loader/sync

let currentCatalog = $state(new Runtime())

/**
 * @param {string} locale
 */
export async function setLocale(locale) {
    currentCatalog = new Runtime(await loadCatalog(locale))
}

export default () => currentCatalog
