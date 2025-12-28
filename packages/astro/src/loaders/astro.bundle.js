// Astro bundle loader template (server-side, synchronous, all locales bundled)
import { toRuntime } from 'wuchale/runtime'

const catalogs = __CATALOGS__
const locales = Object.keys(catalogs)

const store = {}
for (const locale of locales) {
    store[locale] = toRuntime(catalogs[locale], locale)
}

// Get current locale from global context (set by middleware)
function getCurrentLocale() {
    return globalThis.__wuchale_locale__ || locales[0]
}

export const getRuntime = (/** @type {string} */ _loadID) => {
    return store[getCurrentLocale()]
}

export const getRuntimeRx = getRuntime
