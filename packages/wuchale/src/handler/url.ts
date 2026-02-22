import {
    compile as compileUrlPattern,
    match as matchUrlPattern,
    pathToRegexp,
    stringify,
    type Token,
} from 'path-to-regexp'
import { Message, type URLConf } from '../adapters.js'
import type AIQueue from '../ai/index.js'
import { compileTranslation, type Mixed } from '../compile.js'
import { localizeDefault, type URLLocalizer, type URLManifest } from '../url.js'
import { type Catalog, type ItemType, newItem } from './pofile.js'

export const urlAdapterFlagPrefix = 'url:'

export function patternFromTranslate(patternTranslated: string, keys: Token[]) {
    const compiledTranslatedPatt = compileTranslation(patternTranslated, patternTranslated)
    if (typeof compiledTranslatedPatt === 'string') {
        return compiledTranslatedPatt
    }
    const urlTokens: Token[] = (compiledTranslatedPatt as Mixed).map(part => {
        if (typeof part === 'number') {
            return keys[part]
        }
        return { type: 'text', value: part }
    })
    return stringify({ tokens: urlTokens })
}

export function patternToTranslate(pattern: string) {
    const { keys } = pathToRegexp(pattern)
    const compile = compileUrlPattern(pattern, { encode: false })
    const paramsReplace = {}
    for (const [i, { name }] of keys.entries()) {
        paramsReplace[name] = `{${i}}`
    }
    return compile(paramsReplace)
}

export class URLHandler {
    patternKeys: Map<string, string> = new Map()

    localizeUrl?: URLLocalizer
    patterns?: string[] = []

    constructor(urlConf?: URLConf) {
        if (typeof urlConf?.localize === 'function') {
            this.localizeUrl = urlConf.localize
        } else if (urlConf?.localize) {
            this.localizeUrl = localizeDefault
        }
        this.patterns = urlConf?.patterns
    }

    buildManifest = (catalogs: Map<string, Catalog>): URLManifest =>
        this.patterns?.map(patt => {
            const catalogPattKey = this.patternKeys.get(patt)!
            const { keys } = pathToRegexp(patt)
            const locPatterns: string[] = []
            for (const [loc, catalog] of catalogs) {
                let pattern = patt
                const item = catalog.get(catalogPattKey)
                if (item) {
                    const patternTranslated = item.msgstr[0] || item.msgid[0]
                    pattern = patternFromTranslate(patternTranslated, keys)
                }
                locPatterns.push(this.localizeUrl?.(pattern, loc) ?? pattern)
            }
            return [patt, locPatterns]
        }) ?? []

    initPatterns = async (
        locale: string,
        sourceLocale: string,
        adapterKey: string,
        catalog: Catalog,
        aiQueue?: AIQueue,
    ): Promise<boolean> => {
        const urlPatterns = this.patterns ?? []
        const urlPatternsForTranslate = urlPatterns.map(patternToTranslate)
        const urlPatternMsgs = urlPatterns.map((patt, i) => {
            const locPattern = urlPatternsForTranslate[i]
            let context: string | undefined
            if (locPattern !== patt) {
                context = `original: ${patt}`
            }
            return new Message(locPattern, undefined, context)
        })
        const urlPatternCatKeys = urlPatternMsgs.map(msg => msg.toKey())
        const untranslated: ItemType[] = []
        let needWriteCatalog = false
        for (const [i, locPattern] of urlPatternsForTranslate.entries()) {
            const key = urlPatternCatKeys[i]
            this.patternKeys.set(urlPatterns[i], key) // save for href translate
            let item = catalog.get(key)
            if (!item || !item.urlAdapters.size) {
                item = newItem({ msgid: [locPattern] })
                catalog.set(key, item)
                needWriteCatalog = true
            }
            if (!item.urlAdapters.has(adapterKey)) {
                item.urlAdapters.add(adapterKey)
                needWriteCatalog = true
            }
            if (locale === sourceLocale) {
                item.msgstr = [locPattern]
            }
            item.context = urlPatternMsgs[i].context
            if (item.msgstr[0]) {
                continue
            }
            if (locPattern.search(/\p{L}/u) === -1) {
                item.msgstr = item.msgid
                continue
            }
            untranslated.push(item)
        }
        for (const item of catalog.values()) {
            if (item.urlAdapters.has(adapterKey) && !this.patternKeys.has(item.msgid[0])) {
                item.urlAdapters.delete(adapterKey) // no longer used in this adapter
            }
        }
        if (untranslated.length && locale !== sourceLocale && aiQueue) {
            aiQueue.add(untranslated)
            await aiQueue.running
        }
        return needWriteCatalog
    }

    match = (url: string) => {
        for (const pattern of this.patterns ?? []) {
            if (matchUrlPattern(pattern, { decode: false })(url)) {
                return pattern
            }
        }
        return null
    }

    matchToCompile = (key: string, locale: string, catalog: Catalog) => {
        // e.g. key: /items/foo/{0}
        let toCompile = key
        const relevantPattern = this.match(key)
        if (relevantPattern == null) {
            return toCompile
        }
        // e.g. relevantPattern: /items/:rest
        const patternItem = catalog.get(this.patternKeys.get(relevantPattern) ?? '')
        if (patternItem) {
            // e.g. patternItem.msgid: /items/{0}
            const matchedUrl = matchUrlPattern(relevantPattern, { decode: false })(key)
            // e.g. matchUrl.params: {rest: 'foo/{0}'}
            if (matchedUrl) {
                const translatedPattern = patternItem.msgstr[0] || patternItem.msgid[0]
                // e.g. translatedPattern: /elementos/{0}
                const { keys } = pathToRegexp(relevantPattern)
                const translatedPattUrl = patternFromTranslate(translatedPattern, keys)
                // e.g. translatedPattUrl: /elementos/:rest
                const compileTranslated = compileUrlPattern(translatedPattUrl, { encode: false })
                toCompile = compileTranslated(matchedUrl.params)
                // e.g. toCompile: /elementos/foo/{0}
            }
        }
        if (this.localizeUrl) {
            toCompile = this.localizeUrl(toCompile || key, locale)
        }
        return toCompile
    }
}
