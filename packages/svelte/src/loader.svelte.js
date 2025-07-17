// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists.
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
