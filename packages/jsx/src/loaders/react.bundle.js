// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { useState, useEffect } from 'react'

const callbacks = {}

/**
 * @param {string} locale
 */
export function setLocale(locale) {
    for (const callback of Object.values(callbacks)) {
        callback(locale)
    }
}

export default (/** @type {string} */ loadID) => {
    const [locale, setLocale] = useState('en')
    useEffect(() => {
        callbacks[loadID] = (/** @type {string} */ locale) => setLocale(locale)
    })
    return locale
}
