// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists.
import { Runtime } from 'wuchale/runtime'

let currentCatalog = $state(new Runtime())

/**
 * @param {string} locale
 */
export async function setLocale(locale) {
    currentCatalog = new Runtime(await import(`./${locale}.svelte.js`))
}

export default () => currentCatalog
