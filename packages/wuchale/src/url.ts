import { compile, match } from 'path-to-regexp'

export type URLLocalizer = (url: string, locale: string) => string

// public default, used when localized: true
export const localizeDefault: URLLocalizer = (path, loc) => {
    const localized = `/${loc}${path}`
    if (!localized.endsWith('/')) {
        return localized
    }
    return localized.slice(0, -1)
}

export const deLocalizeDefault = (path: string, locales: string[]): [string, string | null] => {
    let iSecondSlash = path.indexOf('/', 2)
    if (iSecondSlash === -1) {
        iSecondSlash = path.length
    }
    const locale = path.slice(1, iSecondSlash)
    if (!locales.includes(locale)) {
        return [path, null]
    }
    let rest = path.slice(1 + locale.length)
    return [rest || '/', locale]
}

type MatchParams = Partial<Record<string, string | string[]>>

const getParams = (path: string, pattern: string): MatchParams | undefined => {
    const matched = match(pattern, { decode: false })(path)
    if (!matched) {
        return
    }
    return matched.params
}

export const fillParams = (params: MatchParams, destPattern: string) => {
    const compiled = compile(destPattern, { encode: false })
    return compiled(params)
}

export type URLManifestItem =
    | [
          string, // /path
          string[], // /path, /ruta
      ]
    | [string] // just /path

export type URLManifest = URLManifestItem[]

type MatchResult = {
    path: string | null
    params: MatchParams
    altPatterns: Record<string, string>
}

const noMatchRes: MatchResult = { path: null, altPatterns: {}, params: {} }

export function URLMatcher(manifest: URLManifest, locales: string[]) {
    const manifestWithLocales = manifest.map(([pattern, localized]) => {
        localized ??= locales.map(_ => pattern)
        const locAndLocalizeds = locales.map((loc, i) => [loc, localized[i]] as [string, string])
        return [pattern, Object.fromEntries(locAndLocalizeds)] as [string, Record<string, string>]
    })
    return (url: string, locale: string | null): MatchResult => {
        if (locale === null) {
            return noMatchRes
        }
        for (const [pattern, altPatterns] of manifestWithLocales) {
            const params = getParams(url, altPatterns[locale])
            if (params) {
                return { path: fillParams(params, pattern), params, altPatterns }
            }
        }
        return noMatchRes
    }
}
