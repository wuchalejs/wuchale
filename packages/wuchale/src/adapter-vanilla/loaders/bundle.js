import toRuntime from "wuchale/runtime"
import { locales } from '${DATA}'

let locale = locales[0]

/**
 * @param {string} newLocale
*/
export function setLocale(newLocale) {
    locale = newLocale
}

/**
 * @param {{ [locale: string]: import("wuchale/runtime").CatalogModule }} catalogs
*/ 
export const getRuntime = catalogs => toRuntime(catalogs[locale], locale)
export const getRuntimeRx = getRuntime
