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

type MatchParams = Record<string, string | string[]>

const getParams = (path: string, pattern: string): MatchParams | null => {
    const matched = match(pattern, {decode: false})(path)
    if (!matched) {
        return
    }
    return matched.params
}

const fillParams = (params: MatchParams, destPattern: string) => {
    const compiled = compile(destPattern, {encode: false})
    return compiled(params)
}

const getAlternates = (params: MatchParams, localizedPatterns: string[][]) => {
    return Object.fromEntries(localizedPatterns.map(([locale, patt]) => [locale, fillParams(params, patt)]))
}

type MatchResult = {
    path: string
    locale: string
    alternates: Record<string, string>
}

export function URLMatcher(manifest: URLManifest) {
    const sourcePatterns = manifest.map(([patt]) => patt)
    return (url: URL): MatchResult => {
        for (const [pattern, localized] of manifest) {
            for (const [locale, locPattern] of localized) {
                const params = getParams(url.pathname, locPattern)
                if (params) {
                    return {path: fillParams(params, pattern), locale, alternates: getAlternates(params, localized)}
                }
            }
        }
        for (const pattern of sourcePatterns) {
            const params = getParams(url.pathname, pattern)
            if (params) {
                return {path: fillParams(params, pattern), locale: null, alternates: {}}
            }
        }
        return {path: null, locale: null, alternates: {}}
    }
}
