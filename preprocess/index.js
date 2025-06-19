import Preprocess, { defaultHeuristic, IndexTracker } from "./prep.js"
import { parse } from "svelte/compiler"
import {writeFile} from 'node:fs/promises'
import compileTranslation from "./compile.js"
import setupGemini from "./gemini.js"
import PO from "pofile"
import { normalize, relative } from "node:path"

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
            const translations = {}
            let total = 0
            let obsolete = 0
            let untranslated = 0
            if (!err) {
                for (const item of po.items) {
                    total++
                    if (item.obsolete) {
                        obsolete++
                        continue
                    }
                    if (!item.msgstr[0]) {
                        untranslated++
                    }
                    translations[item.msgid] = item
                }
            }
            res({translations, total, obsolete, untranslated})
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
    const compiledFname = {}
    const translationsFname = {}
    for (const loc of locales) {
        compiledFname[loc] = `${options.localesDir}/${loc}.json`
        translationsFname[loc] = `${options.localesDir}/${loc}.po`
    }

    let forProduction = false
    let projectRoot = ''

    let sourceTranslations = {}
    let indexTracker = new IndexTracker({})

    const compiled = {}

    async function loadFilesAndSetup() {
        for (const loc of locales) {
            const {translations: trans, total, obsolete, untranslated} = await loadPONoFail(translationsFname[loc])
            translations[loc] = trans
            console.info(`i18n stats (${loc}): total: ${total}, obsolete: ${obsolete}, untranslated: ${untranslated}`)
        }
        sourceTranslations = translations[options.sourceLocale]
        indexTracker = new IndexTracker(sourceTranslations)
        // startup compile
        for (const loc of locales) {
            compiled[loc] = []
            for (const txt in translations[loc]) {
                const poItem = translations[loc][txt]
                if (forProduction) {
                    poItem.references = []
                }
                const index = indexTracker.get(txt)
                compiled[loc][index] = compileTranslation(poItem.msgstr[0], compiled[options.sourceLocale][index])
            }
            await writeFile(compiledFname[loc], JSON.stringify(compiled[loc], null, 2))
        }
    }

    /**
     * @param {string} content
     * @param {import('estree').Program | import("svelte/compiler").AST.Root} ast
     * @param {string} filename
     */
    async function preprocess(content, ast, filename) {
        const prep = new Preprocess(indexTracker, options.heuristic, options.importFrom)
        const txts = prep.process(content, ast)
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
                if (!translated.references.includes(filename)) {
                    translated.references.push(filename)
                }
                if (loc === options.sourceLocale) {
                    if (translated.msgstr[0] !== txt) {
                        translated.msgstr = [txt]
                        newTxts.push(txt)
                    }
                } else if (!translated.msgstr[0]) {
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
        }
        return {
            code: prep.mstr.toString(),
            map: prep.mstr.generateMap(),
        }
    }

    return {
        name: 'wuchale',
        /**
         * @param {{ env: { PROD: boolean; }, root: string; }} config
         */
        async configResolved(config) {
            forProduction = config.env.PROD
            projectRoot = config.root
            await loadFilesAndSetup()
        },
        transform: {
            order: 'pre',
            /**
             * @param {string} code
             * @param {string} id
            */
            handler: async function(code, id) {
                if (!id.startsWith(projectRoot) || id.startsWith(normalize(projectRoot + '/node_modules'))) {
                    return
                }
                const isModule = id.endsWith('.svelte.js') || id.endsWith('.svelte.ts')
                if (!id.endsWith('.svelte') && !isModule) {
                    return
                }
                let ast
                if (isModule) {
                    ast = this.parse(code)
                } else {
                    ast = parse(code, {modern: true})
                }
                const filename = relative(projectRoot, id)
                const processed = await preprocess(code, ast, filename)
                if (processed.code) {
                    for (const loc of locales) {
                        await savePO(translations[loc], translationsFname[loc])
                        await writeFile(compiledFname[loc], JSON.stringify(compiled[loc]))
                    }
                }
                return processed
            }
        },
        async buildEnd() {
            if (!forProduction) {
                // just being pragmatic
                return
            }
            for (const loc of locales) {
                for (const txt in translations[loc]) {
                    const poItem = translations[loc][txt]
                    poItem.obsolete = poItem.references.length === 0
                }
                await savePO(translations[loc], translationsFname[loc])
            }
        },
        setupTesting() {
            for (const loc of locales) {
                translations[loc] = {}
                compiled[loc] = []
            }
            sourceTranslations = translations[options.sourceLocale]
            return {
                translations,
                compiled,
                preprocess,
            }
        }
    }
}
