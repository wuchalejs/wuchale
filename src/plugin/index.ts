import Preprocess, { IndexTracker, NestText, type Translations } from "./prep.js"
import { Parser } from 'acorn'
import { tsPlugin } from '@sveltejs/acorn-typescript'
import { parse, type AST } from "svelte/compiler"
import { writeFile, readFile } from 'node:fs/promises'
import compileTranslation, { type CompiledFragment } from "./compile.js"
import GeminiQueue, { type ItemType } from "./gemini.js"
import { glob } from "tinyglobby"
import PO from "pofile"
import { normalize, relative } from "node:path"
import type { Program, Options as ParserOptions } from "acorn"
import { getOptions, type Config as Config } from "../config.js"

const pluginName = 'wuchale'
const virtualPrefix = `virtual:${pluginName}/`
const virtualResolvedPrefix = '\0'
const modulePatterns = ['.svelte.js', '.svelte.ts']
const markupPatterns = ['.svelte']
const patterns = [...modulePatterns, ...markupPatterns]

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

type ViteHotUpdateCTX = {
    file: string,
    server: {
        moduleGraph: {
            getModuleById: Function,
            invalidateModule: Function,
        },
    },
    timestamp: number,
}

async function loadPOFile(filename: string): Promise<LoadedPO> {
    return new Promise((res, rej) => {
        PO.load(filename, (err, po) => {
            const translations: Translations = {}
            let total = 0
            let obsolete = 0
            let untranslated = 0
            if (err) {
                rej(err)
                return
            }
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

    #config: Config

    locales: string[]

    // exposed for testing
    _translations: { [loc: string]: { [key: string]: ItemType } } = {}
    _compiled: { [locale: string]: (CompiledFragment | number)[] } = {}

    #sourceTranslations: { [key: string]: ItemType }

    #compiledFname: { [loc: string]: string } = {}
    #translationsFname: { [loc: string]: string } = {}

    #currentPurpose: 'dev' | 'extract' | 'test' = 'dev'
    #projectRoot: string = ''
    #indexTracker: IndexTracker

    #geminiQueue: { [loc: string]: GeminiQueue } = {}

    #transFnamesToLocales: { [key: string]: string } = {}

    transform: { order: 'pre', handler: any }

    #allowDirs: string[] = []

    constructor() {
        this.#indexTracker = new IndexTracker({})
    }

    init = async (configRaw: Config) => {
        this.#config = await getOptions(configRaw)
        this.locales = [this.#config.sourceLocale, ...this.#config.otherLocales]
        for (const loc of this.locales) {
            this.#compiledFname[loc] = `${this.#config.localesDir}/${loc}.js`
            this.#translationsFname[loc] = `${this.#config.localesDir}/${loc}.po`
        }
        for (const loc of this.#config.otherLocales) {
            if (loc === this.#config.sourceLocale) {
                throw Error('Source locale cannot included in other locales.')
            }
            this.#geminiQueue[loc] = new GeminiQueue(
                this.#config.sourceLocale,
                loc,
                this.#config.geminiAPIKey,
                async () => await this.afterExtract(loc),
            )
        }
        if (this.#config.hmr) {
            this.transform = {
                order: 'pre',
                handler: this.transformHandler,
            }
        }
    }

    directExtract = async () => {
        const all = []
        for (const dir of this.#config.srcDirs) {
            for (const patternEnd of patterns) {
                for (const file of await glob(`${dir}/**/*${patternEnd}`)) {
                    const contents = await readFile(file)
                    all.push(this.transformHandler(contents.toString(), normalize(process.cwd() + '/' + file)))
                }
            }
        }
        await Promise.all(all)
    }

    #loadTranslations = async (loc: string) => {
        try {
            const { translations: trans, total, obsolete, untranslated } = await loadPOFile(this.#translationsFname[loc])
            this._translations[loc] = trans
            console.info(`i18n stats (${loc}): total: ${total}, obsolete: ${obsolete}, untranslated: ${untranslated}`)
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err
            }
            this._translations[loc] = {}
            if (this.#currentPurpose === 'dev') {
                await this.directExtract()
            }
        }
    }

    #compile = (loc: string) => {
        this._compiled[loc] = []
        for (const key in this._translations[loc]) {
            const poItem = this._translations[loc][key]
            const index = this.#indexTracker.get(key)
            this._compiled[loc][index] = compileTranslation(poItem.msgstr[0], this._compiled[this.#config.sourceLocale][index])
        }
        for (const [i, item] of this._compiled[loc].entries()) {
            if (item == null) {
                this._compiled[loc][i] = 0 // reduce json size
            }
        }
    }

    #loadFilesAndSetup = async () => {
        for (const loc of this.locales) {
            await this.#loadTranslations(loc)
        }
        this.#sourceTranslations = this._translations[this.#config.sourceLocale]
        this.#indexTracker = new IndexTracker(this.#sourceTranslations)
        if (this.#currentPurpose === 'test') {
            return
        }
        for (const loc of this.locales) {
            this.#compile(loc)
            await writeFile(this.#compiledFname[loc], `export {default} from '${virtualPrefix}${loc}'`)
        }
    }

    afterExtract = async (loc: string) => {
        if (this.#currentPurpose !== 'test') {
            await savePO(Object.values(this._translations[loc]), this.#translationsFname[loc])
        }
        if (this.#currentPurpose !== 'extract') {
            this.#compile(loc)
        }
    }

    #preprocess = async (content: string, ast: AST.Root | Program, filename: string) => {
        const prep = new Preprocess(this.#indexTracker, this.#config.heuristic)
        const txts = prep.process(content, ast)
        if (!txts.length) {
            return {}
        }
        for (const loc of this.locales) {
            const newTxts: ItemType[] = []
            for (const nTxt of txts) {
                let key = nTxt.toKey()
                let translated = this._translations[loc][key]
                if (!translated) {
                    translated = new PO.Item()
                    translated.msgid = nTxt.toString()
                    this._translations[loc][key] = translated
                }
                if (nTxt.context) {
                    translated.msgctxt = nTxt.context
                }
                if (!translated.references.includes(filename)) {
                    translated.references.push(filename)
                }
                if (loc === this.#config.sourceLocale) {
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
            if (loc === this.#config.sourceLocale || !this.#geminiQueue[loc].url) {
                await this.afterExtract(loc)
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

    configResolved = async (config: { env: { PROD?: boolean, EXTRACT?: boolean; }, root: string; }) => {
        if (config.env.EXTRACT) {
            this.#currentPurpose = 'extract'
        } else if (config.env.PROD == null) {
            this.#currentPurpose = "test"
            for (const loc of this.locales) {
                this._translations[loc] = {}
                this._compiled[loc] = []
            }
            this.#sourceTranslations = this._translations[this.#config.sourceLocale]
        } // else, already dev
        this.#projectRoot = config.root
        // for transform
        for (const dir of this.#config.srcDirs) {
            this.#allowDirs.push(normalize(this.#projectRoot + '/' + dir))
        }
        // for handleHotUpdate below
        this.#transFnamesToLocales = Object.fromEntries(
            Object.entries(this.#translationsFname)
                .map(([loc, fname]) => [normalize(this.#projectRoot + '/' + fname), loc]),
        )
        await this.#loadFilesAndSetup()
    }

    handleHotUpdate = async (ctx: ViteHotUpdateCTX) => {
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
        return `export default ${JSON.stringify(this._compiled[locale])}`
    }

    transformHandler = async (code: string, id: string) => {
        if (!this.#allowDirs.find(dir => id.startsWith(dir))) {
            return
        }
        const isModule = modulePatterns.find(p => id.endsWith(p))
        if (!markupPatterns.find(p => id.endsWith(p)) && !isModule) {
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

export default async function wuchale(config: Config = {}) {
    const plugin = new Plugin()
    await plugin.init(config)
    return plugin
}
