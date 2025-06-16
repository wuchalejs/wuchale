// $$ cd .. && npm run test

import Preprocess, { IndexTracker } from "./prep.js"
import {writeFileSync} from 'node:fs'
import compileTranslation from "./compile.js"
import setupGemini from "./gemini.js"
import PO from "pofile"

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
async function loadPONoFail(filename) {
    return new Promise((res) => {
        PO.load(filename, (err, po) => {
            if (err) {
                res({})
                return
            }
            const translations = {}
            for (const item of po.items) {
                translations[item.msgid] = item
            }
            res(translations)
        })
    })
}

/**
 * @param {{ [s: string]: any; } | ArrayLike<any>} translations
 * @param {string} filename
 */
async function savePO(translations, filename) {
    const po = new PO()
    for (const item of Object.values(translations)) {
        po.items.push(item)
    }
    return new Promise((res, rej) => {
        po.save(filename, err => {
            if (err) {
                rej(err)
            } else {
                res()
            }
        })
    })
}

function mergeOptionsWithDefault(options = defaultOptions) {
    for (const key of Object.keys(defaultOptions)) {
        if (key in options) {
            continue
        }
        options[key] = defaultOptions[key]
    }
}

export default async function wuchale(options = defaultOptions) {
    mergeOptionsWithDefault(options)
    const locales = [options.sourceLocale, ...options.otherLocales]
    const translations = {}
    const compiled = {}
    const compiledFname = {}
    const translationsFname = {}
    for (const loc of locales) {
        translationsFname[loc] = `${options.localesDir}/${loc}.po`
        translations[loc] = await loadPONoFail(translationsFname[loc])
        compiledFname[loc] = `${options.localesDir}/${loc}.json`
    }

    const sourceTranslations = translations[options.sourceLocale]

    const indexTracker = new IndexTracker(sourceTranslations)

    // startup compile
    for (const loc of locales) {
        compiled[loc] = []
        for (const txt in translations[loc]) {
            compiled[loc][indexTracker.get(txt)] = compileTranslation(translations[loc][txt].msgstr[0])
        }
        writeFileSync(compiledFname[loc], JSON.stringify(compiled[loc], null, 2))
    }

    /**
     * @param {string} content
     * @param {Function} [parseModule]
     */
    async function preprocess(content, parseModule) {
        const prep = new Preprocess(indexTracker, options.heuristic, options.importFrom)
        let txts
        if (parseModule) {
            txts = prep.processModule(content, parseModule)
        } else {
            txts = prep.processComponent(content)
        }
        if (!txts.length) {
            return {}
        }
        for (const loc of locales) {
            const newTxts = []
            for (const nTxt of txts) {
                const txt = nTxt.toString()
                let translated = translations[loc][txt]
                if (translated == null) {
                    translated = new PO.Item()
                    translated.msgid = txt
                    translations[loc][txt] = translated
                }
                if (loc === options.sourceLocale) {
                    if (translated.msgstr[0] !== txt) {
                        translated.msgstr = [txt]
                        newTxts.push(txt)
                    }
                } else if (!translated.msgstr.length) {
                    translated.msgstr = [sourceTranslations[txt].msgstr[0]] // fallback
                    newTxts.push(txt)
                }
            }
            if (loc !== options.sourceLocale && newTxts.length) {
                const geminiT = setupGemini(options.sourceLocale, loc, options.geminiAPIKey)
                if (geminiT) {
                    const gTrans = await geminiT(newTxts)
                    for (const txt of newTxts) {
                        translations[loc][txt].msgstr = [gTrans[txt]]
                    }
                }
            }
            for (const nTxt of txts) {
                const txt = nTxt.toString()
                const index = indexTracker.get(txt)
                compiled[loc][index] = compileTranslation(translations[loc][txt].msgstr[0], compiled[options.sourceLocale][index])
            }
            for (const [i, c] of compiled[loc].entries()) {
                if (c == null) {
                    compiled[loc][i] = 0 // reduce json size for jumped indices, instead of null
                }
            }
            if (!newTxts.length) {
                continue
            }
            await savePO(translations[loc], translationsFname[loc])
            writeFileSync(compiledFname[loc], JSON.stringify(compiled[loc]))
        }
        return {
            code: prep.mstr.toString(),
            map: prep.mstr.generateMap(),
        }
    }

    return {
        name: 'wuchale',
        transform: {
            order: 'pre',
            /**
             * @param {string} code
             * @param {string} id
            */
            handler: function(code, id) {
                const isModule = id.endsWith('.svelte.js')
                if (!id.endsWith('.svelte') && !isModule) {
                    return
                }
                return preprocess(code, isModule && this.parse)
            }
        },
    }
}
