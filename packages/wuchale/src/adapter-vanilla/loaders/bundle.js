// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

let locale = 'en'

/**
 * @param {string} newLocale
*/
export function setLocale(newLocale) {
    locale = newLocale
}

/**
 * @param {{ [locale: string]: import("wuchale/runtime").CatalogModule }} catalogs
*/ 
export const getCatalog = catalogs => catalogs[locale]
export const getCatalogRx = getCatalog
