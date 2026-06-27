import { useEffect, useMemo, useState } from 'react'
import toRuntime from 'wuchale/runtime'
import { locales } from '${DATA}'

let locale = locales[0]

const callbacks = new Set([
    (/** @type {import('${DATA}').Locale} */ loc) => {
        locale = loc
    },
])

/**
 * @param {import('${DATA}').Locale} locale
 */
export function setLocale(locale) {
    for (const callback of callbacks) {
        callback(locale)
    }
}

/**
 * @param {{[locale in import('${DATA}').Locale]: import('wuchale/runtime').CatalogModule }} catalogs
 */
export const getRuntimeRx = catalogs => {
    const [locale, setLocale] = useState(locales[0])
    useEffect(() => {
        const cb = (/** @type {import('${DATA}').Locale} */ locale) => setLocale(locale)
        callbacks.add(cb)
        return () => callbacks.delete(cb)
    }, [])
    // biome-ignore lint/correctness/useExhaustiveDependencies: catalogs is a constant
    return useMemo(() => toRuntime(locale, catalogs[locale]), [locale])
}

/**
 * non-reactive
 * @param {{[locale in import('${DATA}').Locale]: import('wuchale/runtime').CatalogModule }} catalogs
 */
export const getRuntime = catalogs => toRuntime(locale, catalogs[locale])
