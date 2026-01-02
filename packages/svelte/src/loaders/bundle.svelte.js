import toRuntime from 'wuchale/runtime'
import { locales } from '${DATA}'

let locale = $state(locales[0])

/**
 * @param {string} newLocale
 */
export function setLocale(newLocale) {
    locale = newLocale
}

// for non-reactive
/**
 * @param {{ [locale: string]: import("wuchale/runtime").CatalogModule }} catalogs
 */
export const getRuntime = (catalogs) => toRuntime(catalogs[locale], locale)

// same function, only will be inside $derived when used
export const getRuntimeRx = getRuntime
