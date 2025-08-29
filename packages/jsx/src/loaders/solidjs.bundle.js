// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.
// The content is this way because you have enabled bundleLoad in the config.

import { createSignal } from "solid-js"

const [locale, setLocale] = createSignal('en')

export { setLocale }

/**
 * @param {{ [locale: string]: import('wuchale/runtime').CatalogModule }} catalogs
 */
export const get = catalogs => catalogs[locale()]
// same function, because solid-js can use them anywhere
export default get
