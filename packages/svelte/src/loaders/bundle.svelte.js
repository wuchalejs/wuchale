// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

let locale = $state('en')

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
export const getCatalog = catalogs => catalogs[locale]

// same function, only will be inside $derived when used
export const getCatalogRx = getCatalog
