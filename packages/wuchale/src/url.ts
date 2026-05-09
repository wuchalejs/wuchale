// $ node --import ../testing/resolve.ts %n.test.ts

const wilds = ['/**', '/*', '*', '/?', '?'] as const // longer should be first
// corresponsing indices
const [DOUBLE, SINGLESL, SINGLE, OPTIONALSL, OPTIONAL] = [0, 1, 2, 3, 4] as const
// meanings
const [HASDOUBLE, HASSINGLE, SINGLESMIN, OPTIONALMAX, HASOPTIONAL] = [0, 1, 2, -2, -1] as const
const DEFAULT_PREV_WILD = [false, -1, false, -1, false] as [boolean, number, boolean, number, boolean]

export type Pattern = (string | number)[]

export function compilePattern(pattern: string) {
    const parts: Pattern = []
    if (pattern.length > 1 && pattern.endsWith('/')) {
        pattern = pattern.slice(0, -1)
    }
    let prevProps = DEFAULT_PREV_WILD.slice() as typeof DEFAULT_PREV_WILD
    for (let i = 0; i < pattern.length; i++) {
        let iWildInPatMin = -1
        let wildIdxMin: number | null = null
        for (let wi = 0; wi < wilds.length; wi++) {
            const iWildInPat = pattern.indexOf(wilds[wi]!, i)
            if (iWildInPat === -1 || (iWildInPatMin !== -1 && iWildInPat >= iWildInPatMin)) {
                continue
            }
            iWildInPatMin = iWildInPat
            wildIdxMin = wi
        }
        if (wildIdxMin === null) {
            parts.push(pattern.slice(i))
            prevProps = DEFAULT_PREV_WILD.slice() as typeof DEFAULT_PREV_WILD
            break
        }
        if (iWildInPatMin > i) {
            const slice = pattern.slice(i, iWildInPatMin)
            if (slice !== '/' || i === 0) {
                parts.push(slice)
                prevProps = DEFAULT_PREV_WILD.slice() as typeof DEFAULT_PREV_WILD
            }
        }
        if (wildIdxMin === DOUBLE) {
            if (!prevProps[DOUBLE]) {
                prevProps[DOUBLE] = true
                parts.push(HASDOUBLE)
            }
        } else if (wildIdxMin === OPTIONAL) {
            if (!prevProps[OPTIONAL]) {
                prevProps[OPTIONAL] = true
                parts.push(HASOPTIONAL)
            }
        } else if (wildIdxMin === OPTIONALSL) {
            if (prevProps[OPTIONALSL] === -1) {
                prevProps[OPTIONALSL] = parts.length
                parts.push(OPTIONALMAX)
            } else {
                ;(parts[prevProps[OPTIONALSL]] as number)--
            }
        } else if (wildIdxMin === SINGLE) {
            if (!prevProps[SINGLE]) {
                prevProps[SINGLE] = true
                parts.push(HASSINGLE)
            }
        } else if (wildIdxMin === SINGLESL) {
            if (prevProps[SINGLESL] === -1) {
                prevProps[SINGLESL] = parts.length
                parts.push(SINGLESMIN)
            } else {
                ;(parts[prevProps[SINGLESL]] as number)++
            }
        }
        i = iWildInPatMin + wilds[wildIdxMin]!.length - 1
    }
    return parts
}

function slashCheckFails(
    url: string,
    fromI: number,
    toI: number,
    singles: number,
    optionals: number,
    double: boolean,
    single: boolean,
) {
    if (fromI === toI) {
        return singles > 0 || single
    }
    if (singles === 0 && optionals === 0) {
        return false
    }
    let slashes = 0
    for (let i = url.indexOf('/', fromI); i !== -1 && i < toI; i = url.indexOf('/', i + 1)) {
        slashes++
    }
    if (toI - fromI === slashes) {
        return true
    }
    return slashes < singles || (!double && slashes - optionals > singles)
}

export function matchPattern(pattern: Pattern, url: string) {
    let endI = url.length
    if (endI > 1 && url.endsWith('/')) {
        endI--
    }
    let hasDoubleLast = false
    let singlesLast = 0
    let optionalsLast = 0
    let hasSingleLast = false
    let hasOptionalLast = false
    let lastI = 0
    const dynamics: string[] = []
    for (const patt of pattern) {
        if (typeof patt === 'number') {
            if (patt === HASDOUBLE) {
                hasDoubleLast = true
            } else if (patt <= OPTIONALMAX) {
                optionalsLast = OPTIONALMAX - patt + 1
            } else if (patt === HASOPTIONAL) {
                hasOptionalLast = true
            } else if (patt === HASSINGLE) {
                hasSingleLast = true
            } else {
                singlesLast = patt - SINGLESMIN + 1
            }
            continue
        }
        const singles = singlesLast
        const optionals = optionalsLast
        const hasDouble = hasDoubleLast
        const hasSingle = hasSingleLast
        const hasOptional = hasOptionalLast
        singlesLast = 0
        optionalsLast = 0
        hasDoubleLast = false
        hasOptionalLast = false
        hasSingleLast = false
        const i = url.indexOf(patt, lastI)
        const prevI = lastI
        lastI = i + patt.length
        if (i === -1) {
            return false
        }
        if (!hasDouble && !hasOptional && !hasSingle && singles === 0 && optionals === 0) {
            if (i > 0) {
                return false
            }
            continue
        }
        if (slashCheckFails(url, prevI, i, singles, optionals, hasDouble, hasSingle)) {
            return false
        }
        dynamics.push(url.slice(prevI, i))
    }
    if (lastI === endI) {
        if (singlesLast > 0 || lastI === 0) {
            return false
        }
        if (!hasDoubleLast) {
            return dynamics
        }
    }
    if (!hasDoubleLast && !hasOptionalLast && !hasSingleLast && singlesLast === 0 && optionalsLast === 0) {
        return false
    }
    if (slashCheckFails(url, lastI, endI, singlesLast, optionalsLast, hasDoubleLast, hasSingleLast)) {
        return false
    }
    dynamics.push(url.slice(lastI, endI))
    return dynamics
}

export function stringifyPattern(pattern: Pattern, dynamics: readonly string[]) {
    let i = 0
    let lastIsDynamic = false
    let assembled = ''
    for (const p of pattern) {
        if (typeof p === 'string') {
            assembled += p
            lastIsDynamic = false
            continue
        }
        if (lastIsDynamic) {
            continue
        }
        assembled += dynamics[i++] ?? '' // undefined when optional and []
        lastIsDynamic = true
    }
    return assembled
}

export type URLManifestItem =
    | [
          Pattern, // ['/path'] base pattern
          Pattern[], // [['/path'], ['/ruta']] for en, es
      ]
    | [Pattern] // just ['/path'] for all

export type URLManifest = URLManifestItem[]

type MatchResult<L extends string> = {
    path: string | null
    params: string[]
    altPatterns: Record<L, Pattern>
}

const noMatchRes: MatchResult<string> = { path: null, altPatterns: {}, params: [] }

export function URLMatcher<L extends string>(manifest: URLManifest, locales: L[]) {
    const manifestWithLocales = manifest.map(([pattern, localized]) => {
        localized ??= locales.map(_ => pattern)
        const locAndLocalizeds = locales.map((loc, i) => [loc, localized[i]] as [string, Pattern])
        return [pattern, Object.fromEntries(locAndLocalizeds)] as [Pattern, Record<L, Pattern>]
    })
    return (url: string, locale: L | null): MatchResult<L> => {
        if (locale === null) {
            return noMatchRes
        }
        for (const [pattern, altPatterns] of manifestWithLocales) {
            const params = matchPattern(altPatterns[locale]!, url)
            if (params) {
                return { path: stringifyPattern(pattern, params), params, altPatterns }
            }
        }
        return noMatchRes
    }
}

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
