// $$ cd .. && npm run test

import Preprocess, { IndexTracker } from "./prep.js"
import {writeFileSync, readFileSync} from 'node:fs'
import compileTranslation from "./compile.js"
import setupGemini from "./gemini.js"

/**
 * @param {string} text
 * @param {string} scope
 * @returns {{extract: boolean, replace: string}}
 */
export function defaultHeuristic(text, scope = 'markup') {
    if (scope === 'markup') {
        if (text.startsWith('-')) {
            return {extract: false, replace: text.slice(1)}
        }
        return {extract: true, replace: text}
    }
    // script and attribute
    if (text.startsWith('+')) {
        return {extract: true, replace: text.slice(1)}
    }
    const range = 'AZ'
    const startCode = text.charCodeAt(0)
    if (startCode >= range.charCodeAt(0) && startCode <= range.charCodeAt(1)) {
        return {extract: true, replace: text}
    }
    return {extract: false, replace: text}
}

export const defaultOptions = {
    sourceLocale: 'en',
    otherLocales: ['am'],
    localesDir: './locales',
    importFrom: 'wuchale/runtime.svelte',
    heuristic: defaultHeuristic,
    geminiAPIKey: 'env',
}

/**
 * @param {string} filename
 */
function readFileNoFail(filename) {
    try {
        const contents = readFileSync(filename)
        const text = contents.toString().trim()
        if (!text) {
            return
        }
        return text
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err
        }
    }
}

/**
 * @param {string} filename
 */
function readJSONNoFail(filename) {
    const content = readFileNoFail(filename)
    if (content) {
        return JSON.parse(content)
    }
}

function mergeOptionsWithDefault(options = defaultOptions) {
    for (const key of Object.keys(defaultOptions)) {
        if (key in options) {
            continue
        }
        options[key] = defaultOptions[key]
    }
}

export default function setupPreprocess(options = defaultOptions) {
    mergeOptionsWithDefault(options)
    const locales = [options.sourceLocale, ...options.otherLocales]
    const translations = {}
    const compiled = {}
    const compiledFname = {}
    const translationsFname = {}
    for (const loc of locales) {
        translationsFname[loc] = `${options.localesDir}/${loc}.json`
        translations[loc] = readJSONNoFail(translationsFname[loc]) ?? {}
        compiledFname[loc] = `${options.localesDir}/${loc}.c.json`
    }

    const sourceTranslations = translations[options.sourceLocale]

    const indexTracker = new IndexTracker(sourceTranslations)

    // startup compile
    for (const loc of locales) {
        compiled[loc] = readJSONNoFail(compiledFname[loc]) ?? []
        for (const txt in translations[loc]) {
            compiled[loc][indexTracker.get(txt)] = compileTranslation(translations[loc][txt])
        }
        writeFileSync(compiledFname[loc], JSON.stringify(compiled[loc], null, 2))
    }

    /**
     * @param {{ content: any; filename: any; }} toPreprocess
     */
    function preprocess(toPreprocess) {
        const prep = new Preprocess(indexTracker, options.heuristic, options.importFrom)
        let txts = prep.process(toPreprocess)
        if (!txts.length) {
            return {}
        }
        const promise = (async () => {
            for (const loc of locales) {
                const newTxts = []
                for (const nTxt of txts) {
                    const txt = nTxt.toString()
                    const translated = translations[loc][txt]
                    if (loc === options.sourceLocale) {
                        if (translated !== txt) {
                            translations[loc][txt] = txt
                            newTxts.push(txt)
                        }
                    } else if (translated == null) {
                        translations[loc][txt] = sourceTranslations[txt] // fallback
                        newTxts.push(txt)
                    }
                }
                if (loc !== options.sourceLocale && newTxts.length) {
                    const geminiT = setupGemini(options.sourceLocale, loc, options.geminiAPIKey)
                    if (geminiT) {
                        const gTrans = await geminiT(newTxts)
                        for (const txt of newTxts) {
                            translations[loc][txt] = gTrans[txt]
                        }
                    }
                }
                for (const nTxt of txts) {
                    const txt = nTxt.toString()
                    const index = indexTracker.get(txt)
                    compiled[loc][index] = compileTranslation(translations[loc][txt], compiled[options.sourceLocale][index])
                }
                for (const [i, c] of compiled[loc].entries()) {
                    if (c == null) {
                        compiled[loc][i] = 0 // reduce json size for jumped indices, instead of null
                    }
                }
                if (!newTxts.length) {
                    continue
                }
                writeFileSync(translationsFname[loc], JSON.stringify(translations[loc], null, 2))
                writeFileSync(compiledFname[loc], JSON.stringify(compiled[loc]))
            }
        })()
        return {
            code: prep.mstr.toString(),
            map: prep.mstr.generateMap(),
            dependencies: locales.map(loc => translationsFname[loc]),
            promise,
        }
    }

    return {
        markup: preprocess,
    }
}
