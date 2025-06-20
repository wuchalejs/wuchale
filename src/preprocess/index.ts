import Preprocess, { defaultHeuristic, IndexTracker, NestText, type HeuristicFunc, type Translations } from "./prep.js"
import { parse, type AST } from "svelte/compiler"
import { writeFile } from 'node:fs/promises'
import compileTranslation, { type CompiledFragment } from "./compile.js"
import setupGemini, { type ItemType } from "./gemini.js"
import PO from "pofile"
import { normalize, relative } from "node:path"
import type { Program } from 'estree'

export interface Options {
    sourceLocale?: string
    otherLocales?: string[]
    localesDir?: string
    heuristic?: HeuristicFunc
    geminiAPIKey?: string
}

export const defaultOptions: Options = {
    sourceLocale: 'en',
    otherLocales: [],
    localesDir: './src/locales',
    heuristic: defaultHeuristic,
    geminiAPIKey: 'env',
}

function mergeOptionsWithDefault(options = defaultOptions) {
    for (const key of Object.keys(defaultOptions)) {
        if (key in options) {
            continue
        }
        options[key] = defaultOptions[key]
    }
}

interface LoadedPO {
    translations: Translations,
    total: number,
    obsolete: number,
    untranslated: number,
}

async function loadPONoFail(filename: string): Promise<LoadedPO> {
    return new Promise((res) => {
        PO.load(filename, (err, po) => {
            const translations: Translations = {}
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
                    const nTxt = new NestText(item.msgid, null, item.msgctxt)
                    translations[nTxt.toKey()] = item
                }
            }
            res({ translations, total, obsolete, untranslated })
        })
    })
}

async function savePO(translations: ItemType[], filename: string) {
    const po = new PO()
    for (const item of Object.values(translations)) {
        po.items.push(item)
    }
    return new Promise((res, rej) => {
        po.save(filename, err => {
            if (err) {
                rej(err)
            } else {
                res(null)
            }
        })
    })
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

    const compiled: { [locale: string]: CompiledFragment[] } = {}

    async function loadFilesAndSetup() {
        for (const loc of locales) {
            const { translations: trans, total, obsolete, untranslated } = await loadPONoFail(translationsFname[loc])
            translations[loc] = trans
            console.info(`i18n stats (${loc}): total: ${total}, obsolete: ${obsolete}, untranslated: ${untranslated}`)
        }
        sourceTranslations = translations[options.sourceLocale]
        indexTracker = new IndexTracker(sourceTranslations)
        // startup compile
        for (const loc of locales) {
            compiled[loc] = []
            for (const key in translations[loc]) {
                const poItem = translations[loc][key]
                if (forProduction) {
                    poItem.references = []
                }
                const index = indexTracker.get(key)
                compiled[loc][index] = compileTranslation(poItem.msgstr[0], compiled[options.sourceLocale][index])
            }
            await writeFile(compiledFname[loc], JSON.stringify(compiled[loc], null, 2))
        }
    }

    async function preprocess(content: string, ast: AST.Root | Program, filename: string) {
        const prep = new Preprocess(indexTracker, options.heuristic)
        const txts = prep.process(content, ast)
        if (!txts.length) {
            return {}
        }
        for (const loc of locales) {
            const newTxts = []
            for (const nTxt of txts) {
                let key = nTxt.toKey()
                let translated = translations[loc][key]
                if (translated == null) {
                    translated = new PO.Item()
                    translated.msgid = nTxt.toString()
                    translations[loc][key] = translated
                }
                if (nTxt.context) {
                    translated.msgctxt = nTxt.context
                }
                if (!translated.references.includes(filename)) {
                    translated.references.push(filename)
                }
                if (loc === options.sourceLocale) {
                    const txt = nTxt.toString()
                    if (translated.msgstr[0] !== txt) {
                        translated.msgstr = [txt]
                        newTxts.push(translated)
                    }
                } else if (!translated.msgstr[0]) {
                    newTxts.push(translated)
                }
            }
            if (loc !== options.sourceLocale && newTxts.length) {
                const geminiT = setupGemini(options.sourceLocale, loc, options.geminiAPIKey)
                if (geminiT) {
                    console.info('Gemini translate', newTxts.length, 'items...')
                    await geminiT(newTxts) // will update because it's by reference
                }
            }
            for (const nTxt of txts) {
                const key = nTxt.toKey()
                const index = indexTracker.get(key)
                compiled[loc][index] = compileTranslation(translations[loc][key].msgstr[0], compiled[options.sourceLocale][index])
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

    const order: 'pre' = 'pre'
    return {
        name: 'wuchale',
        async configResolved(config: { env: { PROD?: boolean; }, root: string; }) {
            forProduction = config.env.PROD
            projectRoot = config.root
            await loadFilesAndSetup()
        },
        transform: {
            order,
            handler: async function(code: string, id: string) {
                if (!id.startsWith(projectRoot) || id.startsWith(normalize(projectRoot + '/node_modules'))) {
                    return
                }
                const isModule = id.endsWith('.svelte.js') || id.endsWith('.svelte.ts')
                if (!id.endsWith('.svelte') && !isModule) {
                    return
                }
                let ast: AST.Root | Program
                if (isModule) {
                    ast = this.parse(code)
                } else {
                    ast = parse(code, { modern: true })
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
                for (const key in translations[loc]) {
                    const poItem = translations[loc][key]
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
