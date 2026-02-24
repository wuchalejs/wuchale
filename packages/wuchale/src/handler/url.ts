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
import { type Catalog, type Item, itemIsUrl, newItem } from '../storage.js'
import { type URLManifest } from '../url.js'

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

    patterns?: string[] = []

    constructor(urlConf?: URLConf) {
        this.patterns = urlConf?.patterns
    }

    buildManifest = (catalogs: Catalog[]): URLManifest =>
        // order of catalogs should be based on locales
        this.patterns?.map(patt => {
            const catalogPattKey = this.patternKeys.get(patt)!
            const { keys } = pathToRegexp(patt)
            const locPatterns: string[] = []
            for (const catalog of catalogs) {
                let pattern = patt
                const item = catalog.get(catalogPattKey)
                if (item) {
                    const patternTranslated = item.msgstr[0] || item.msgid[0]
                    pattern = patternFromTranslate(patternTranslated, keys)
                }
                locPatterns.push(pattern)
            }
            if (locPatterns.some(p => p !== patt)) {
                return [patt, locPatterns]
            }
            return [patt]
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
        const untranslated: Item[] = []
        let needWriteCatalog = false
        for (const [i, locPattern] of urlPatternsForTranslate.entries()) {
            const key = urlPatternCatKeys[i]
            this.patternKeys.set(urlPatterns[i], key) // save for href translate
            let item = catalog.get(key)
            if (!item || !itemIsUrl(item)) {
                item = newItem({ msgid: [locPattern] })
                catalog.set(key, item)
                needWriteCatalog = true
            }
            if (!item.urlAdapters.includes(adapterKey)) {
                item.urlAdapters.push(adapterKey)
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
        const urlPatternCatKeysSet = new Set(urlPatternCatKeys)
        for (const item of catalog.values()) {
            const key = new Message(item.msgid, undefined, item.context).toKey()
            if (item.urlAdapters.includes(adapterKey) && !urlPatternCatKeysSet.has(key)) {
                item.urlAdapters = item.urlAdapters.filter(a => a !== adapterKey) // no longer used in this adapter
                needWriteCatalog = true
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

    matchToCompile = (key: string, catalog: Catalog) => {
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
        return toCompile
    }
}
