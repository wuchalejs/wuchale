import { createSignal } from 'solid-js'
import toRuntime from 'wuchale/runtime'

const [locale, setLocale] = createSignal('en')

export { setLocale }

/**
 * @param {{ [locale: string]: import('wuchale/runtime').CatalogModule }} catalogs
 */
export const getRuntimeRx = (catalogs) => toRuntime(catalogs[locale()], locale())
// same function, because solid-js can use them anywhere
export const getRuntime = getRuntimeRx
