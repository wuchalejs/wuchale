import { compile, match } from "path-to-regexp"

export type URLManifestItem = [
    string, // pattern
    [string, string][] // locale, localizedPath
]

export type URLManifest = URLManifestItem[]

type GetLocale = (url: URL, locales: string[]) => string | null

export type URLLocalizer = (url: string, locale: string) => string

export const localizeDefault: URLLocalizer = (url, loc) => {
    const localized = `/${loc}${url}`
    if (!localized.endsWith('/')) {
        return localized
    }
    return localized.slice(0, -1)
}

export const getLocaleDefault: GetLocale = (url, locales) => {
    let iSecondSlash = url.pathname.indexOf('/', 2)
    if (iSecondSlash === -1) {
        iSecondSlash = url.pathname.length
    }
    const locale = url.pathname.slice(1, iSecondSlash)
    if (locales.includes(locale)) {
        return locale
    }
    return null
}

export function URLMatcher(manifest: URLManifest) {
    const matchPattern = (path: string, srcPattern: string, destPattern?: string) => {
        const matched = match(srcPattern, {decode: false})(path)
        if (!matched) {
            return
        }
        if (!destPattern) {
            return matched.path
        }
        const compiled = compile(destPattern, {encode: false})
        return compiled(matched.params)
    }
    const sourcePatterns = manifest.map(([patt]) => patt)
    return (url: URL) => {
        for (const [pattern, localized] of manifest) {
            for (const [locale, locPattern] of localized) {
                const path = matchPattern(url.pathname, locPattern, pattern)
                if (path) {
                    return {path, locale}
                }
            }
        }
        for (const pattern of sourcePatterns) {
            const path = matchPattern(url.pathname, pattern)
            if (path) {
                return {path, locale: null}
            }
        }
        return {path: null, locale: null}
    }
}
