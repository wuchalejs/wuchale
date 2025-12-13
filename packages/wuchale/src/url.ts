import { compile, match } from "path-to-regexp"

export type URLManifestItem = [
    string, // /foo
    string[] // /en/foo, /es/foo
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

type MatchParams = Partial<Record<string, string | string[]>>

const getParams = (path: string, pattern: string): MatchParams | undefined => {
    const matched = match(pattern, {decode: false})(path)
    if (!matched) {
        return
    }
    return matched.params
}

export const fillParams = (params: MatchParams, destPattern: string) => {
    const compiled = compile(destPattern, {encode: false})
    return compiled(params)
}

type MatchResult = {
    path: string | null
    locale: string | null
    params: MatchParams,
    altPatterns: Record<string, string>
}

export function URLMatcher(manifest: URLManifest, locales: string[]) {
    const manifestWithLocales = manifest.map(([pattern, localized]) => {
        const locAndLocalizeds = locales.map((loc, i) => [loc, localized[i]] as [string, string])
        return [
            pattern,
            locAndLocalizeds,
            Object.fromEntries(locAndLocalizeds),
        ] as [string, [string, string][], Record<string, string>]
    })
    return (url: URL): MatchResult => {
        for (const [pattern, locAndLocalizeds, altPatterns] of manifestWithLocales) {
            for (const [locale, locPattern] of locAndLocalizeds) {
                const params = getParams(url.pathname, locPattern)
                if (params) {
                    return {path: fillParams(params, pattern), locale, params, altPatterns}
                }
            }
        }
        for (const [pattern, , altPatterns] of manifestWithLocales) {
            const params = getParams(url.pathname, pattern)
            if (params) {
                return {path: fillParams(params, pattern), locale: null, params, altPatterns}
            }
        }
        return {path: null, locale: null, altPatterns: {}, params: {}}
    }
}
