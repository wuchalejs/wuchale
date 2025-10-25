// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

import { useState, useEffect, useMemo } from 'react'
import toRuntime from 'wuchale/runtime'

let locale = 'en'

const callbacks = new Set([(/** @type {string} */ loc) => {locale = loc}])

/**
 * @param {string} locale
 */
export function setLocale(locale) {
    for (const callback of callbacks) {
        callback(locale)
    }
}

export const getRuntimeRx = (/** @type {{[locale: string]: import('wuchale/runtime').CatalogModule }} */ catalogs) => {
    const [locale, setLocale] = useState('en')
    useEffect(() => {
        const cb = (/** @type {string} */ locale) => setLocale(locale)
        callbacks.add(cb)
        return () => callbacks.delete(cb)
    }, [catalogs])
    return useMemo(() => toRuntime(catalogs[locale], locale), [locale, catalogs])
}

// non-reactive
export const getRuntime = (/** @type {{[locale: string]: import('wuchale/runtime').CatalogModule }} */ catalogs) => toRuntime(catalogs[locale], locale)
