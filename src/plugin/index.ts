import Preprocess, { defaultHeuristic, IndexTracker, NestText, type HeuristicFunc, type Translations } from "./prep.js"
import {Parser} from 'acorn'
import {tsPlugin} from '@sveltejs/acorn-typescript'
import { parse, type AST } from "svelte/compiler"
import { writeFile } from 'node:fs/promises'
import compileTranslation, { type CompiledFragment } from "./compile.js"
import GeminiQueue, { type ItemType } from "./gemini.js"
import PO from "pofile"
import { normalize, relative } from "node:path"
import type { Program, Options as ParserOptions } from "acorn"

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

const ScriptParser = Parser.extend(tsPlugin())

const scriptParseOptions: ParserOptions = {
    sourceType: 'module',
    ecmaVersion: 'latest',
    locations: true
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

async function savePO(translations: ItemType[], filename: string): Promise<void> {
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

    let currentPurpose: "dev" | "prod" | "test" = "dev"
    let projectRoot = ''

    let sourceTranslations = {}
    let indexTracker = new IndexTracker({})

    const compiled: { [locale: string]: CompiledFragment[] | number } = {}

    async function loadTranslations(loc: string) {
        const { translations: trans, total, obsolete, untranslated } = await loadPONoFail(translationsFname[loc])
        translations[loc] = trans
        console.info(`i18n stats (${loc}): total: ${total}, obsolete: ${obsolete}, untranslated: ${untranslated}`)
    }

    async function compileAndWrite(loc: string) {
        compiled[loc] = []
        for (const key in translations[loc]) {
            const poItem = translations[loc][key]
            if (currentPurpose === 'prod') {
                poItem.references = []
            }
            const index = indexTracker.get(key)
            compiled[loc][index] = compileTranslation(poItem.msgstr[0], compiled[options.sourceLocale][index])
        }
        for (const [i, item] of compiled[loc].entries()) {
            if (item == null) {
                compiled[loc][i] = 0 // reduce json size
            }
        }
        if (currentPurpose !== 'test') {
            await writeFile(compiledFname[loc], JSON.stringify(compiled[loc], null, 2))
        }
    }

    async function loadFilesAndSetup() {
        for (const loc of locales) {
            await loadTranslations(loc)
        }
        sourceTranslations = translations[options.sourceLocale]
        indexTracker = new IndexTracker(sourceTranslations)
        for (const loc of locales) {
            await compileAndWrite(loc)
        }
    }

    // gemini
    const geminiQueue: {[loc: string]: GeminiQueue} = {}
    for (const loc of locales) {
        // no need to separate source locale, it will be inert but will call the same onComplete
        geminiQueue[loc] = new GeminiQueue(options.sourceLocale, loc, options.geminiAPIKey, async () => {
            // we don't need to write on every transformation when building
            if (currentPurpose === 'prod') {
                return
            }
            for (const loc of locales) {
                if (currentPurpose === 'dev') {
                    await savePO(translations[loc], translationsFname[loc])
                }
                await compileAndWrite(loc)
            }
        })
    }

    function preprocess(content: string, ast: AST.Root | Program, filename: string) {
        const prep = new Preprocess(indexTracker, options.heuristic)
        const txts = prep.process(content, ast)
        if (!txts.length) {
            return {}
        }
        for (const loc of locales) {
            const newTxts: ItemType[] = []
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
                if (geminiQueue[loc].url) {
                    console.info('Gemini translate', newTxts.length, 'items to', loc)
                }
                // we still need to call onComplete, so always
                geminiQueue[loc].add(newTxts)
            }
        }
        return {
            code: prep.mstr.toString(),
            map: prep.mstr.generateMap(),
        }
    }

    let transFnamesToLocales: {[key: string]: string} = {}
    const order: 'pre' = 'pre'
    return {
        name: 'wuchale',
        async configResolved(config: { env: { PROD?: boolean; }, root: string; }) {
            if (config.env.PROD == null) {
                currentPurpose = "test"
                for (const loc of locales) {
                    translations[loc] = {}
                    compiled[loc] = []
                }
                sourceTranslations = translations[options.sourceLocale]
            } else if (config.env.PROD) {
                currentPurpose = "prod"
            } // else, already dev
            projectRoot = config.root
            transFnamesToLocales = Object.fromEntries(
                Object.entries(translationsFname)
                    .map(([loc, fname]) => [normalize(projectRoot + '/' + fname), loc]),
            )
            await loadFilesAndSetup()
        },
        async handleHotUpdate(ctx: {file: string}) {
            if (ctx.file in transFnamesToLocales) {
                const loc = transFnamesToLocales[ctx.file]
                await loadTranslations(loc)
                await compileAndWrite(loc)
            }
        },
        transform: {
            order,
            handler: function(code: string, id: string) {
                if (!id.startsWith(projectRoot) || id.startsWith(normalize(projectRoot + '/node_modules'))) {
                    return
                }
                const isModule = id.endsWith('.svelte.js') || id.endsWith('.svelte.ts')
                if (!id.endsWith('.svelte') && !isModule) {
                    return
                }
                let ast: AST.Root | Program
                if (isModule) {
                    ast = ScriptParser.parse(code, scriptParseOptions)
                } else {
                    ast = parse(code, { modern: true })
                }
                const filename = relative(projectRoot, id)
                return preprocess(code, ast, filename)
            }
        },
        async buildEnd() {
            if (currentPurpose == 'dev') {
                // just being pragmatic
                return
            }
            for (const loc of locales) {
                const geminiRunning = geminiQueue[loc].running
                if (geminiRunning) {
                    console.info(`Waiting for Gemini (${loc})...`)
                    await geminiRunning
                }
                for (const key in translations[loc]) {
                    const poItem = translations[loc][key]
                    poItem.obsolete = poItem.references.length === 0
                }
                await savePO(translations[loc], translationsFname[loc])
                await compileAndWrite(loc) // we need to write it finally
            }
        },
        setupTesting() {
            return {
                translations,
                compiled,
            }
        }
    }
}
