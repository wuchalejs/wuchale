// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { useState, useEffect } from 'react'

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

export default (/** @type {{[locale: string]: import('wuchale/runtime').CatalogModule }} */ catalogs) => {
    const [locale, setLocale] = useState('en')
    useEffect(() => {
        const cb = (/** @type {string} */ locale) => setLocale(locale)
        callbacks.add(cb)
        return () => callbacks.delete(cb)
    })
    return catalogs[locale]
}

// non-reactive
export const get = (/** @type {{[locale: string]: import('wuchale/runtime').CatalogModule }} */ catalogs) => catalogs[locale]
