import { createSignal } from 'solid-js'
import toRuntime from 'wuchale/runtime'
import { locales } from '${DATA}'

const [locale, setLocale] = createSignal(locales[0])

export { setLocale }

/**
 * @param {{ [locale in import('${DATA}').Locale]: import('wuchale/runtime').CatalogModule }} catalogs
 */
export const getRuntimeRx = catalogs => toRuntime(catalogs[locale()], locale())
// same function, because solid-js can use them anywhere
export const getRuntime = getRuntimeRx
