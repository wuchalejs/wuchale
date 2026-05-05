// $ node --import ../testing/resolve.ts %n.test.ts

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

const wilds = ['/**', '*'] as const // longer should be first

const DOUBLE = 0 // index of **
const SINGLE = 1 // index of *

export type Pattern = (string | number)[]

export function compilePattern(pattern: string) {
    const parts: Pattern = []
    if (pattern.length > 1 && pattern.endsWith('/')) {
        pattern = pattern.slice(0, -1)
    }
    let prevWildI = [-1, -1] as [number, number] // corresponsing to wilds
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
            prevWildI = [-1, -1]
            break
        }
        if (iWildInPatMin > 0 && iWildInPatMin > i) {
            const slice = pattern.slice(i, iWildInPatMin)
            if (slice !== '/' || i === 0) {
                parts.push(slice)
                prevWildI = [-1, -1]
            }
        }
        if (wildIdxMin === DOUBLE) {
            if (prevWildI[DOUBLE] === -1) {
                prevWildI[DOUBLE] = parts.length
                parts.push(wildIdxMin)
            }
        } else if (wildIdxMin === SINGLE) {
            if (prevWildI[SINGLE] === -1) {
                prevWildI[SINGLE] = parts.length
                parts.push(1)
            } else {
                ;(parts[prevWildI[SINGLE]] as number)++
            }
        }
        i = iWildInPatMin + wilds[wildIdxMin]!.length - 1
    }
    return parts
}

function countSlash(url: string, fromIdx: number, toIdx?: number) {
    let count = 0
    for (let i = url.indexOf('/', fromIdx); i !== -1 && i < (toIdx ?? url.length); i = url.indexOf('/', i + 1)) {
        count++
    }
    return count
}

const slashCheckFails = (slashes: number, singles: number, double: boolean) =>
    slashes < singles - 1 || (!double && slashes >= singles)

export function matchPattern(pattern: Pattern, url: string) {
    if (url.length > 1 && url.endsWith('/')) {
        url = url.slice(0, -1)
    }
    let hasDoubleLast = false
    let singlesLast = 0
    let lastI = 0
    const dynamics: string[] = []
    for (const patt of pattern) {
        if (typeof patt === 'number') {
            if (patt === 0) {
                hasDoubleLast = true
            } else {
                singlesLast = patt
            }
            continue
        }
        const singles = singlesLast
        const hasDouble = hasDoubleLast
        singlesLast = 0
        hasDoubleLast = false
        const i = url.indexOf(patt, lastI)
        const prevI = lastI
        lastI = i + patt.length
        if (i === -1) {
            return false
        }
        if (singles === 0 && !hasDouble) {
            if (i > 0) {
                return false
            }
            continue
        }
        if (singles > 0 && (i === prevI || slashCheckFails(countSlash(url, prevI, i), singles, hasDouble))) {
            return false
        }
        dynamics.push(url.slice(prevI, i))
    }
    if (lastI === url.length) {
        if (singlesLast > 0 || lastI === 0) {
            return false
        }
        if (!hasDoubleLast) {
            return dynamics
        }
    }
    if (singlesLast > 0) {
        const slashCount = countSlash(url, lastI)
        if (slashCheckFails(slashCount, singlesLast, hasDoubleLast) || url.length === slashCount) {
            return false
        }
    } else if (!hasDoubleLast) {
        return false
    }
    if (!hasDoubleLast && url.indexOf('/', lastI) !== -1) {
        return false
    }
    dynamics.push(url.slice(lastI))
    return dynamics
}

export function stringifyPattern(pattern: Pattern, dynamics: readonly string[]) {
    let i = 0
    let lastIsDynamic = false
    const assembled: string[] = []
    for (const p of pattern) {
        if (typeof p === 'string') {
            assembled.push(p)
            lastIsDynamic = false
            continue
        }
        if (lastIsDynamic) {
            continue
        }
        assembled.push(dynamics[i]!)
        i++
        lastIsDynamic = true
    }
    return assembled.join('')
}
