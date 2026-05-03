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

export const deLocalizeDefault = <L extends string>(path: string, locales: L[]): [string, L | null] => {
    let iSecondSlash = path.indexOf('/', 2)
    if (iSecondSlash === -1) {
        iSecondSlash = path.length
    }
    const locale = path.slice(1, iSecondSlash) as L
    if (!locales.includes(locale)) {
        return [path, null]
    }
    const rest = path.slice(1 + locale.length)
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

type MatchResult<L extends string> = {
    path: string | null
    params: MatchParams
    altPatterns: Record<L, string>
}

const noMatchRes: MatchResult<string> = { path: null, altPatterns: {}, params: {} }

export function URLMatcher<L extends string>(manifest: URLManifest, locales: L[]) {
    const manifestWithLocales = manifest.map(([pattern, localized]) => {
        localized ??= locales.map(_ => pattern)
        const locAndLocalizeds = locales.map((loc, i) => [loc, localized[i]] as [string, string])
        return [pattern, Object.fromEntries(locAndLocalizeds)] as [string, Record<string, string>]
    })
    return (url: string, locale: L | null): MatchResult<L> => {
        if (locale === null) {
            return noMatchRes
        }
        for (const [pattern, altPatterns] of manifestWithLocales) {
            const params = getParams(url, altPatterns[locale]!)
            if (params) {
                return { path: fillParams(params, pattern), params, altPatterns }
            }
        }
        return noMatchRes
    }
}

const wilds = ['/*/**', '/**/*', '/**', '*'] as const

const DOUBLE = 2 // index of /**

export type Pattern = (string | number)[]

export function compilePattern(pattern: string) {
    const parts: Pattern = []
    if (pattern.length > 1 && pattern.endsWith('/')) {
        pattern = pattern.slice(0, -1)
    }
    for (let i = 0; i < pattern.length; i++) {
        let iWildInPatMin = -1
        let wildIdxMin: number | null = null
        for (const [wi, wild] of wilds.entries()) {
            const iWildInPat = pattern.indexOf(wild, i)
            if (iWildInPat === -1 || (iWildInPatMin !== -1 && iWildInPat >= iWildInPatMin)) {
                continue
            }
            iWildInPatMin = iWildInPat
            wildIdxMin = wi
        }
        if (wildIdxMin === null) {
            parts.push(pattern.slice(i))
            break
        }
        const wild = wilds[wildIdxMin]!
        if (iWildInPatMin > 0) {
            parts.push(pattern.slice(i, iWildInPatMin))
        }
        parts.push(wildIdxMin)
        i = iWildInPatMin + wild.length - 1
    }
    return parts
}

export function matchPattern(pattern: Pattern, url: string) {
    let lastWild: number | null = null
    let lastI = 0
    if (url.length > 1 && url.endsWith('/')) {
        url = url.slice(0, -1)
    }
    for (const patt of pattern) {
        if (typeof patt === 'number') {
            lastWild = patt
            continue
        }
        const wild = lastWild
        lastWild = null // reset
        const i = url.indexOf(patt, lastI)
        if (i === -1) {
            return false
        }
        if (wild === null) {
            if (i > 0) {
                return false
            }
            lastI = i + patt.length
            continue
        }
        if (wild <= DOUBLE) {
            lastI = i + patt.length
            continue
        }
        const iSlash = url.indexOf('/', lastI)
        if ((iSlash > lastI && iSlash < i) || iSlash === lastI) {
            return false
        }
        lastI = i + patt.length
    }
    if (lastI === url.length) {
        return (lastWild === null || lastWild === DOUBLE) && lastI > 0
    }
    if (lastWild === null) {
        return false
    }
    return lastWild <= DOUBLE || url.indexOf('/', lastI) === -1
}
