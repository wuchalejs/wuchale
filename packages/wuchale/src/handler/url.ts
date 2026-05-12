import { isDeepStrictEqual } from 'node:util'
import { getKey, type URLConf, type UrlMatcher } from '../adapters.js'
import type AIQueue from '../ai/index.js'
import { type Catalog, type Item, newItem } from '../storage.js'
import { compilePattern, matchPattern, type Pattern, stringifyPattern, type URLManifest } from '../url.js'

export class URLHandler {
    readonly locales: string[]
    readonly sourceLocale: string
    readonly patterns: string[] = []
    readonly compiledPatterns: Map<string, Pattern>[] = []

    constructor(locales: string[], sourceLocale: string, urlConf?: URLConf) {
        this.locales = locales
        this.sourceLocale = sourceLocale
        if (urlConf?.patterns) {
            this.patterns = urlConf.patterns
        }
    }

    buildManifest = (): URLManifest => {
        // order of catalogs should be based on locales
        const manifest: URLManifest = []
        for (let i = 0; i < this.patterns.length; i++) {
            const locPatterns: Pattern[] = []
            const compiledPatts = this.compiledPatterns[i]!
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

    initPatterns = async (adapterKey: string, catalog: Catalog, aiQueue?: AIQueue): Promise<boolean> => {
        const urlPatternCatKeys: string[] = []
        const toTranslate: Item[] = []
        let needWriteCatalog = false
        const toCompile: Item[] = []
        for (const [i, pattern] of this.patterns.entries()) {
            const key = getKey([pattern])
            urlPatternCatKeys[i] = key
            let item = catalog.get(key)
            if (!item) {
                item = newItem({ id: [pattern] }, this.locales)
                catalog.set(key, item)
                needWriteCatalog = true
            }
            if (!item.urlAdapters.includes(adapterKey)) {
                item.urlAdapters.push(adapterKey)
                needWriteCatalog = true
            }
            item.translations.set(this.sourceLocale, [pattern])
            toCompile.push(item)
            if (pattern.search(/\p{L}/u) === -1) {
                for (const loc of this.locales) {
                    if (loc !== this.sourceLocale) {
                        item.translations.set(loc, [pattern])
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
            const sourceTransl = item.translations.get(this.sourceLocale)![0]!
            for (const loc of this.locales) {
                compiled.set(loc, compilePattern(item.translations.get(loc)?.[0] || sourceTransl))
            }
            this.compiledPatterns.push(compiled)
        }
        return needWriteCatalog
    }

    match: UrlMatcher = (url: string) => {
        for (const [i, pattern] of this.compiledPatterns.entries()) {
            const dynamics = matchPattern(pattern.get(this.sourceLocale)!, url)
            if (dynamics) {
                return [i, dynamics] as const
            }
        }
        return null
    }

    matchToCompile = (key: string, locale: string) => {
        // e.g. key: /items/foo/{0}
        const toCompile = key
        const relevantPattern = this.match(key)
        if (relevantPattern == null) {
            return toCompile
        }
        // e.g. relevantPattern: [index of /items/**, [foo/{0}]]
        const [i, dynamics] = relevantPattern
        const translatedCompiled = this.compiledPatterns[i]!.get(locale)!
        // e.g. translatedCompiled: [/elementos, 0]
        return stringifyPattern(translatedCompiled, dynamics)
        // e.g. /elementos/foo/{0}
    }
}
