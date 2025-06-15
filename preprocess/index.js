// $$ cd .. && npm run test

import Preprocess from "./prep.js"
import {writeFileSync, readFileSync} from 'node:fs'
import compileTranslation from "./compile.js"

export const defaultOptions = {
    otherLocales: ['am'],
    sourceLocale: 'en',
    localesDir: './locales',
    importFrom: 'wuchale/runtime.svelte',
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
    /**
     * @param {{ content: any; filename: any; }} toPreprocess
     */
    function preprocess(toPreprocess) {
        const indicesFname = `${options.localesDir}/index.json`
        const indicesText = readFileNoFail(indicesFname)
        const indices = JSON.parse(indicesText ?? '[]')
        const txtIndices = Object.fromEntries(indices.map((/** @type {string} */ txt, /** @type {number} */ i) => [txt, i]))
        const prep = new Preprocess(txtIndices, indices.length, options.importFrom)
        const txts = prep.process(toPreprocess)
        if (!txts.length) {
            return {}
        }
        const txtsMap = Object.fromEntries(txts.map(txt => [txt, true]))
        let sourceTranslations = {}
        for (const loc of [options.sourceLocale, ...options.otherLocales]) {
            const translationsFname =  `${options.localesDir}/${loc}.json`
            const translations = readJSONNoFail(translationsFname) ?? {}
            let deleted = false
            for (const txt of Object.keys(translations)) {
                if (txt in txtsMap) {
                    continue
                }
                delete translations[txt]
                deleted = true
            }
            if (loc === options.sourceLocale) {
                sourceTranslations = translations
            }
            const compiledFname = `${options.localesDir}/${loc}.c.json`
            const compiled = readJSONNoFail(compiledFname) ?? []
            let added = false
            for (const txt of txts) {
                let translated = translations[txt]
                if (loc === options.sourceLocale) {
                    if (translated === txt) {
                        continue
                    }
                    translations[txt] = txt
                    added = true
                } else if (translated == null) {
                    translations[txt] = sourceTranslations[txt] // fallback
                    added = true
                }
                const index = txtIndices[txt]
                compiled[index] = compileTranslation(translations[txt])
            }
            if (!added && !deleted) {
                continue
            }
            writeFileSync(translationsFname, JSON.stringify(translations, null, 2))
            writeFileSync(compiledFname, JSON.stringify(compiled))
        }
        const newIndices = []
        for (const [txt, i] of Object.entries(txtIndices)) {
            newIndices[i] = txt
        }
        const indicesTextNew = JSON.stringify(newIndices)
        if (indicesTextNew !== indicesText) {
            writeFileSync(indicesFname, indicesTextNew)
        }
        return {
            code: prep.mstr.toString(),
            map: prep.mstr.generateMap(),
        }
    }
    return {
        markup: preprocess,
    }
}
