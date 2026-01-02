import { useEffect, useMemo, useState } from 'react'
import toRuntime from 'wuchale/runtime'
import { locales } from '${DATA}'

let locale = locales[0]

const callbacks = new Set([
    (/** @type {string} */ loc) => {
        locale = loc
    },
])

/**
 * @param {string} locale
 */
export function setLocale(locale) {
    for (const callback of callbacks) {
        callback(locale)
    }
}

export const getRuntimeRx = (/** @type {{[locale: string]: import('wuchale/runtime').CatalogModule }} */ catalogs) => {
    const [locale, setLocale] = useState(locales[0])
    useEffect(() => {
        const cb = (/** @type {string} */ locale) => setLocale(locale)
        callbacks.add(cb)
        return () => callbacks.delete(cb)
    }, [catalogs])
    return useMemo(() => toRuntime(catalogs[locale], locale), [locale, catalogs])
}

// non-reactive
export const getRuntime = (/** @type {{[locale: string]: import('wuchale/runtime').CatalogModule }} */ catalogs) =>
    toRuntime(catalogs[locale], locale)
