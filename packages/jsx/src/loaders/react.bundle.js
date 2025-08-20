// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { useState, useEffect } from 'react'

const callbacks = new Set()

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
        callbacks.add((/** @type {string} */ locale) => setLocale(locale))
    })
    return catalogs[locale]
}
