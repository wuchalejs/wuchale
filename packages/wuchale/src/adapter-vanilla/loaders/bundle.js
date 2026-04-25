import toRuntime from 'wuchale/runtime'
import { locales } from '${DATA}'

let locale = locales[0]

/**
 * @param {import('${DATA}').Locale} newLocale
 */
export function setLocale(newLocale) {
    locale = newLocale
}

/**
 * @param {{ [locale in import('${DATA}').Locale]: import("wuchale/runtime").CatalogModule }} catalogs
 */
export const getRuntime = catalogs => toRuntime(catalogs[locale], locale)
export const getRuntimeRx = getRuntime
