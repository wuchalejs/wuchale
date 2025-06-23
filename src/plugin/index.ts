import Preprocess, { IndexTracker, NestText, type Translations } from "./prep.js"
import { Parser } from 'acorn'
import { tsPlugin } from '@sveltejs/acorn-typescript'
import { parse, type AST } from "svelte/compiler"
import { writeFile } from 'node:fs/promises'
import compileTranslation, { type CompiledFragment } from "./compile.js"
import GeminiQueue, { type ItemType } from "./gemini.js"
import PO from "pofile"
import { normalize, relative } from "node:path"
import type { Program, Options as ParserOptions } from "acorn"
import { getOptions, type Options } from "../options.js"

const pluginName = 'wuchale'
const virtualPrefix = `virtual:${pluginName}/`
const virtualResolvedPrefix = '\0'

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

class Plugin {

    name = pluginName

    #options: Options
    #locales: string[]

    // exposed for testing
    translations: { [loc: string]: { [key: string]: ItemType } } = {}
    compiled: { [locale: string]: (CompiledFragment | number)[] } = {}

    #sourceTranslations: { [key: string]: ItemType }

    #compiledFname: { [loc: string]: string } = {}
    #translationsFname: { [loc: string]: string } = {}

    #currentPurpose: 'dev' | 'prod' | 'test' = 'dev'
    #projectRoot: string = ''
    #indexTracker: IndexTracker

    #geminiQueue: { [loc: string]: GeminiQueue } = {}

    #transFnamesToLocales: { [key: string]: string } = {}

    transform: { order: 'pre', handler: Function }

    #allowDirs: string[] = []

    constructor() {
        this.#indexTracker = new IndexTracker({})
    }

    init = async (optionsRaw: Options) => {
        this.#options = await getOptions(optionsRaw)
        this.#locales = [this.#options.sourceLocale, ...this.#options.otherLocales]
        for (const loc of this.#locales) {
            this.#compiledFname[loc] = `${this.#options.localesDir}/${loc}.js`
            this.#translationsFname[loc] = `${this.#options.localesDir}/${loc}.po`
        }
        for (const loc of this.#options.otherLocales) {
            if (loc === this.#options.sourceLocale) {
                throw Error('Source locale cannot included in other locales.')
            }
            this.#geminiQueue[loc] = new GeminiQueue(this.#options.sourceLocale, loc, this.#options.geminiAPIKey, async () => await this.#afterExtract(loc))
        }
        if (this.#options.hmr) {
            this.transform = {
                order: 'pre',
                handler: this.transformHandler,
            }
        }
    }

    #loadTranslations = async (loc: string) => {
        const { translations: trans, total, obsolete, untranslated } = await loadPONoFail(this.#translationsFname[loc])
        this.translations[loc] = trans
        console.info(`i18n stats (${loc}): total: ${total}, obsolete: ${obsolete}, untranslated: ${untranslated}`)
    }

    #compile = (loc: string) => {
        this.compiled[loc] = []
        for (const key in this.translations[loc]) {
            const poItem = this.translations[loc][key]
            if (this.#currentPurpose === 'prod') {
                poItem.references = []
            }
            const index = this.#indexTracker.get(key)
            this.compiled[loc][index] = compileTranslation(poItem.msgstr[0], this.compiled[this.#options.sourceLocale][index])
        }
        for (const [i, item] of this.compiled[loc].entries()) {
            if (item == null) {
                this.compiled[loc][i] = 0 // reduce json size
            }
        }
    }

    #loadFilesAndSetup = async () => {
        for (const loc of this.#locales) {
            await this.#loadTranslations(loc)
        }
        this.#sourceTranslations = this.translations[this.#options.sourceLocale]
        this.#indexTracker = new IndexTracker(this.#sourceTranslations)
        if (this.#currentPurpose === 'test') {
            return
        }
        for (const loc of this.#locales) {
            this.#compile(loc)
            await writeFile(this.#compiledFname[loc], `export {default} from '${virtualPrefix}${loc}'`)
        }
    }

    #afterExtract = async (loc: string) => {
        if (this.#currentPurpose === 'dev') {
            await savePO(Object.values(this.translations[loc]), this.#translationsFname[loc])
        }
        this.#compile(loc)
    }

    #preprocess = async (content: string, ast: AST.Root | Program, filename: string) => {
        const prep = new Preprocess(this.#indexTracker, this.#options.heuristic)
        const txts = prep.process(content, ast)
        if (!txts.length) {
            return {}
        }
        for (const loc of this.#locales) {
            const newTxts: ItemType[] = []
            for (const nTxt of txts) {
                let key = nTxt.toKey()
                let translated = this.translations[loc][key]
                if (!translated) {
                    translated = new PO.Item()
                    translated.msgid = nTxt.toString()
                    this.translations[loc][key] = translated
                }
                if (nTxt.context) {
                    translated.msgctxt = nTxt.context
                }
                if (!translated.references.includes(filename)) {
                    translated.references.push(filename)
                }
                if (loc === this.#options.sourceLocale) {
                    const txt = nTxt.toString()
                    if (translated.msgstr[0] !== txt) {
                        translated.msgstr = [txt]
                        newTxts.push(translated)
                    }
                } else if (!translated.msgstr[0]) {
                    newTxts.push(translated)
                }
            }
            if (newTxts.length == 0) {
                continue
            }
            if (loc === this.#options.sourceLocale || !this.#geminiQueue[loc].url) {
                await this.#afterExtract(loc)
                continue
            }
            const newRequest = this.#geminiQueue[loc].add(newTxts)
            const opType = `(${newRequest ? 'new request' : 'add to request'})`
            console.info('Gemini translate', newTxts.length, 'items to', loc, opType)
            await this.#geminiQueue[loc].running
        }
        return {
            code: prep.mstr.toString(),
            map: prep.mstr.generateMap(),
        }
    }

    configResolved = async (config: { env: { PROD?: boolean; }, root: string; }) => {
        if (config.env.PROD == null) {
            this.#currentPurpose = "test"
            for (const loc of this.#locales) {
                this.translations[loc] = {}
                this.compiled[loc] = []
            }
            this.#sourceTranslations = this.translations[this.#options.sourceLocale]
        } else if (config.env.PROD) {
            this.#currentPurpose = "prod"
        } // else, already dev
        this.#projectRoot = config.root
        // for transform
        for (const dir of this.#options.srcDirs) {
            this.#allowDirs.push(normalize(this.#projectRoot + '/' + dir))
        }
        // for handleHotUpdate below
        this.#transFnamesToLocales = Object.fromEntries(
            Object.entries(this.#translationsFname)
                .map(([loc, fname]) => [normalize(this.#projectRoot + '/' + fname), loc]),
        )
        await this.#loadFilesAndSetup()
    }

    handleHotUpdate = async (ctx: { file: string, server: { moduleGraph: { getModuleById: Function, invalidateModule: Function } }, timestamp: number }) => {
        // PO file edit -> JS HMR
        if (ctx.file in this.#transFnamesToLocales) {
            const loc = this.#transFnamesToLocales[ctx.file]
            await this.#loadTranslations(loc)
            this.#compile(loc)
            const moduleId = virtualResolvedPrefix + virtualPrefix + loc
            const module = ctx.server.moduleGraph.getModuleById(moduleId)
            if (module) {
                ctx.server.moduleGraph.invalidateModule(
                    module,
                    [],
                    ctx.timestamp,
                    true
                )
                return [module]
            }
        }
    }

    resolveId = (source: string) => {
        if (source.startsWith(virtualPrefix)) {
            return virtualResolvedPrefix + source
        }
        return null
    }

    load = (id: string) => {
        const prefix = virtualResolvedPrefix + virtualPrefix
        if (!id.startsWith(prefix)) {
            return null
        }
        const locale = id.slice(prefix.length)
        return `export default ${JSON.stringify(this.compiled[locale])}`
    }

    transformHandler = async (code: string, id: string) => {
        if (!this.#allowDirs.find(dir => id.startsWith(dir))) {
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
        const filename = relative(this.#projectRoot, id)
        return await this.#preprocess(code, ast, filename)
    }
}

export default async function wuchale(options: Options = {}) {
    const plugin = new Plugin()
    await plugin.init(options)
    return plugin
}
