import { isDeepStrictEqual } from 'node:util'
import { getKey, type URLConf, type UrlMatcher } from '../adapters.js'
import type AIQueue from '../ai/index.js'
import { type Catalog, type Item, newItem } from '../storage.js'
import { compilePattern, matchPattern, type Pattern, stringifyPattern, type URLManifest } from '../url.js'

export function getPathEnd(url: string) {
    const qpStart = url.indexOf('?')
    const hashStart = url.indexOf('#')
    if (qpStart === hashStart) {
        return url.length // both -1
    }
    if (qpStart === -1 || (hashStart !== -1 && hashStart < qpStart)) {
        return hashStart
    }
    return qpStart
}

export class URLHandler {
    readonly locales: string[]
    readonly sourceLocale: string
    readonly patterns: string[] = []
    readonly compiledPatterns = new Map<string, Map<string, Pattern>>()

    constructor(locales: string[], sourceLocale: string, urlConf?: URLConf) {
        this.locales = locales
        this.sourceLocale = sourceLocale
        if (urlConf?.patterns) {
            this.patterns = urlConf.patterns
        }
    }

    initPatterns = async (
        adapterKey: string,
        catalog: Catalog,
        fallbackChains: Map<string, string[]>,
        aiQueue?: AIQueue,
    ): Promise<boolean> => {
        const urlPatternCatKeys: string[] = []
        const toTranslate: Item[] = []
        let needWriteCatalog = false
        const toCompile: Item[] = []
        for (const [i, pattern] of this.patterns.entries()) {
            const key = getKey(pattern)
            urlPatternCatKeys[i] = key
            let item = catalog.get(key)
            if (!item) {
                item = newItem({}, this.locales)
                catalog.set(key, item)
                needWriteCatalog = true
            }
            if (!item.urlAdapters.includes(adapterKey)) {
                item.urlAdapters.push(adapterKey)
                needWriteCatalog = true
            }
            item.translations.set(this.sourceLocale, pattern)
            toCompile.push(item)
            if (pattern.search(/\p{L}/u) === -1) {
                for (const loc of this.locales) {
                    if (loc !== this.sourceLocale) {
                        item.translations.set(loc, pattern)
                    }
                }
                continue
            }
            toTranslate.push(item)
        }
        const urlPatternCatKeysSet = new Set(urlPatternCatKeys)
        for (const item of catalog.values()) {
            const id = item.translations.get(this.sourceLocale)!
            if (item.urlAdapters.includes(adapterKey) && !urlPatternCatKeysSet.has(getKey(id, item.context))) {
                item.urlAdapters = item.urlAdapters.filter(a => a !== adapterKey) // no longer used in this adapter
                needWriteCatalog = true
            }
        }
        if (toTranslate.length && aiQueue) {
            aiQueue.add(toTranslate)
            await aiQueue.running
        }
        // for matching hrefs
        for (const item of toCompile) {
            const compiled = new Map<string, Pattern>()
            for (const locale of this.locales) {
                for (const loc of fallbackChains.get(locale) ?? [locale, this.sourceLocale]) {
                    const pattern = item.translations.get(loc) as string
                    if (pattern) {
                        compiled.set(locale, compilePattern(pattern))
                        break
                    }
                }
            }
            this.compiledPatterns.set(item.translations.get(this.sourceLocale) as string, compiled)
        }
        return needWriteCatalog
    }

    buildManifest = (): URLManifest => {
        // order of catalogs should be based on locales
        const manifest: URLManifest = []
        for (const pattern of this.patterns) {
            const locPatterns: Pattern[] = []
            const compiledPatts = this.compiledPatterns.get(pattern)!
            const compiledPattBase = compiledPatts.get(this.sourceLocale)!
            for (const loc of this.locales) {
                const locCompiledPatt = compiledPatts.get(loc)!
                locPatterns.push(locCompiledPatt)
            }
            const notAllSame = locPatterns.some(p => !isDeepStrictEqual(p, compiledPattBase))
            manifest.push(notAllSame ? [compiledPattBase, locPatterns] : [compiledPattBase])
        }
        return manifest
    }

    match: UrlMatcher = (url: string) => {
        url = url.slice(0, getPathEnd(url))
        for (const [pattern, compiled] of this.compiledPatterns.entries()) {
            const dynamics = matchPattern(compiled.get(this.sourceLocale)!, url)
            if (dynamics) {
                return pattern
            }
        }
        return null
    }

    matchToCompile = (link: string, pattern: string, locale: string) => {
        // e.g. link: /items/foo/{0}?qp=val#hash, pattern: /items/**
        const compiled = this.compiledPatterns.get(pattern)!.get(locale)!
        // e.g. compiled: [/elementos, 0]
        const pathEnd = getPathEnd(link)
        const dynamics = matchPattern(compiled, link.slice(0, pathEnd)) as string[]
        // e.g. dynamics: [foo/{0}]
        return stringifyPattern(compiled, dynamics) + link.slice(pathEnd)
        // e.g. /elementos/foo/{0}?qp=val#hash
    }
}
