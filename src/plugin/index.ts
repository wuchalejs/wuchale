import Preprocess, { IndexTracker, NestText, type Translations } from "./prep.js"
import { Parser } from 'acorn'
import { tsPlugin } from '@sveltejs/acorn-typescript'
import { parse, type AST } from "svelte/compiler"
import { writeFile, readFile } from 'node:fs/promises'
import compileTranslation, { type CompiledFragment } from "./compile.js"
import GeminiQueue, { type ItemType } from "./gemini.js"
import { glob } from "tinyglobby"
import pm, { type Matcher } from 'picomatch'
import PO from "pofile"
import { normalize, relative } from "node:path"
import type { Program, Options as ParserOptions } from "acorn"
import { getOptions, type Config as Config, type GlobConf } from "../config.js"

const pluginName = 'wuchale'
const virtualPrefix = `virtual:${pluginName}/`
const virtualResolvedPrefix = '\0'

const moduleEnd = ['.svelte.js', '.svelte.ts']
const markupEnd = ['.svelte']

interface LoadedPO {
    translations: Translations,
    total: number,
    obsolete: number,
    untranslated: number,
    headers: { [key: string]: string },
}

const ScriptParser = Parser.extend(tsPlugin())

const scriptParseOptions: ParserOptions = {
    sourceType: 'module',
    ecmaVersion: 'latest',
    locations: true
}

type HMRCompiled = { locale: any; data: CompiledFragment[] }

type HMRClient = {
    send: (event: string, data: HMRCompiled) => void
}

type ViteDevServer = {
    ws: {
        send: (event: string, data: HMRCompiled) => void,
        on: (event: string, cb: (msg: object, client: HMRClient) => void) => void,
    }
    moduleGraph: {
        getModuleById: Function,
        invalidateModule: Function,
    },
}

type ViteHotUpdateCTX = {
    file: string,
    server: ViteDevServer,
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
                const nTxt = new NestText([item.msgid, item.msgid_plural], null, item.msgctxt)
                translations[nTxt.toKey()] = item
            }
            res({ translations, total, obsolete, untranslated, headers: po.headers })
        })
    })
}

async function savePO(translations: ItemType[], filename: string, headers = {}): Promise<void> {
    const po = new PO()
    po.headers = headers
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

    _locales: string[]

    // exposed for testing
    _translations: { [loc: string]: { [key: string]: ItemType } } = {}
    _compiled: { [locale: string]: (CompiledFragment | number)[] } = {}

    #poHeaders: { [loc: string]: { [key: string]: string } } = {}

    #sourceTranslations: { [key: string]: ItemType }

    // for HMR
    #server: ViteDevServer

    #compiledFname: { [loc: string]: string } = {}
    #translationsFname: { [loc: string]: string } = {}

    #currentPurpose: 'dev' | 'prod' | 'extract' | 'test' = 'dev'
    #projectRoot: string = ''
    #indexTracker: IndexTracker

    #geminiQueue: { [loc: string]: GeminiQueue } = {}

    #transFnamesToLocales: { [key: string]: string } = {}

    transform: { order: 'pre', handler: any }

    #patterns: Matcher[] = []

    constructor() {
        this.#indexTracker = new IndexTracker({})
    }

    _init = async (configRaw: Config) => {
        this.#config = await getOptions(configRaw)
        this._locales = [
            this.#config.sourceLocale,
            ...Object.keys(this.#config.locales).filter(loc => loc != this.#config.sourceLocale),
        ]
        for (const loc of this._locales) {
            this.#compiledFname[loc] = `${this.#config.localesDir}/${loc}.svelte.js`
            this.#translationsFname[loc] = `${this.#config.localesDir}/${loc}.po`
        }
        const sourceLocaleName = this.#config.locales[this.#config.sourceLocale].name
        for (const loc of this._locales) {
            if (loc === this.#config.sourceLocale) {
                continue
            }
            this.#geminiQueue[loc] = new GeminiQueue(
                sourceLocaleName,
                this.#config.locales[loc].name,
                this.#config.geminiAPIKey,
                async () => await this._afterExtract(loc),
            )
        }
        if (this.#config.hmr) {
            this.transform = {
                order: 'pre',
                handler: this._transformHandler,
            }
        }
    }

    #globOptsToArgs = (pattern: GlobConf): [string[], { ignore: string[] } | undefined] => {
        let patt: string[]
        let options: { ignore: string[] }
        if (typeof pattern === 'string') {
            patt = [pattern]
        } else {
            patt = pattern.pattern
            options = { ignore: pattern.ignore }
        }
        return [patt, options]
    }

    _directExtract = async () => {
        const all = []
        for (const pattern of this.#config.files) {
            for (const file of await glob(...this.#globOptsToArgs(pattern))) {
                const contents = await readFile(file)
                all.push(this._transformHandler(contents.toString(), normalize(process.cwd() + '/' + file)))
            }
        }
        await Promise.all(all)
    }

    #fullHeaders = (loc: string) => {
        const localeConf = this.#config.locales[loc]
        const fullHead = { ...this.#poHeaders[loc] ?? {} }
        const updateHeaders = [
            ['Plural-Forms', `nplurals=${localeConf.nPlurals}; plural=${localeConf.pluralRule};`],
            ['Language', this.#config.locales[loc].name],
            ['MIME-Version', '1.0'],
            ['Content-Type', 'text/plain; charset=utf-8'],
            ['Content-Transfer-Encoding', '8bit'],
            ['PO-Revision-Date', new Date().toISOString()],
        ]
        for (const [key, val] of updateHeaders) {
            fullHead[key] = val
        }
        const defaultHeaders = [
            ['POT-Creation-Date', new Date().toISOString()],
        ]
        for (const [key, val] of defaultHeaders) {
            if (!fullHead[key]) {
                fullHead[key] = val
            }
        }
        return fullHead
    }

    #loadTranslations = async (loc: string) => {
        try {
            const { translations: trans, total, obsolete, untranslated, headers } = await loadPOFile(this.#translationsFname[loc])
            this.#poHeaders[loc] = headers
            this._translations[loc] = trans
            const locName = this.#config.locales[loc].name
            console.info(`i18n stats (${locName}): total: ${total}, obsolete: ${obsolete}, untranslated: ${untranslated}`)
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err
            }
            if (this.#currentPurpose === 'dev' || this.#currentPurpose === 'prod') {
                await this._directExtract()
            }
        }
    }

    #compile = (loc: string) => {
        this._compiled[loc] = []
        for (const key in this._translations[loc]) {
            const poItem = this._translations[loc][key]
            const index = this.#indexTracker.get(key)
            let compiled: CompiledFragment
            const fallback = this._compiled[this.#config.sourceLocale][index]
            if (poItem.msgid_plural) {
                if (poItem.msgstr.join('').trim()) {
                    compiled = poItem.msgstr
                } else {
                    compiled = fallback
                }
            } else {
                compiled = compileTranslation(poItem.msgstr[0], fallback)
            }
            this._compiled[loc][index] = compiled
        }
        for (const [i, item] of this._compiled[loc].entries()) {
            if (item == null) {
                this._compiled[loc][i] = 0 // reduce json size
            }
        }
    }

    #loadFilesAndSetup = async () => {
        for (const loc of this._locales) {
            this._translations[loc] = {}
        } // all before #loadTranslations because we will loop over them in transformHandler at startup
        if (this.#currentPurpose !== 'test') {
            for (const loc of this._locales) {
                await this.#loadTranslations(loc)
            }
        }
        this.#sourceTranslations = this._translations[this.#config.sourceLocale]
        this.#indexTracker = new IndexTracker(this.#sourceTranslations)
        if (this.#currentPurpose === 'test') {
            return
        }
        for (const loc of this._locales) {
            this.#compile(loc)
            if (this.#currentPurpose !== 'dev') {
                await writeFile(this.#compiledFname[loc], `export {default, pluralsRule} from '${virtualPrefix}${loc}'`)
                continue
            }
            await writeFile(this.#compiledFname[loc], `
                import defaultData, {pluralsRule} from '${virtualPrefix}${loc}'
                const data = $state(defaultData)
                import.meta.hot.on('${pluginName}:update', ({locale, data: newData}) => {
                    if (locale !== '${loc}') {
                        return
                    }
                    for (let i = 0; i < newData.length; i++) {
                        if (JSON.stringify(data[i]) !== JSON.stringify(newData[i])) {
                            data[i] = newData[i]
                        }
                    }
                })
                import.meta.hot.send('${pluginName}:get', {locale: '${loc}'})
                export {pluralsRule}
                export default data
            `)
        }
    }

    _afterExtract = async (loc: string) => {
        if (this.#currentPurpose !== 'test') {
            await savePO(Object.values(this._translations[loc]), this.#translationsFname[loc], this.#fullHeaders(loc))
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
        for (const loc of this._locales) {
            const newTxts: ItemType[] = []
            for (const nTxt of txts) {
                let key = nTxt.toKey()
                let poItem = this._translations[loc][key]
                if (!poItem) {
                    // @ts-ignore
                    poItem = new PO.Item({ nplurals: this.#config.locales[loc].nPlurals })
                    poItem.msgid = nTxt.text[0]
                    if (nTxt.plural) {
                        poItem.msgid_plural = nTxt.text[1] ?? nTxt.text[0]
                    }
                    this._translations[loc][key] = poItem
                }
                if (nTxt.context) {
                    poItem.msgctxt = nTxt.context
                }
                if (!poItem.references.includes(filename)) {
                    poItem.references.push(filename)
                }
                if (loc === this.#config.sourceLocale) {
                    const txt = nTxt.text.join('\n')
                    if (poItem.msgstr.join('\n') !== txt) {
                        poItem.msgstr = nTxt.text
                        newTxts.push(poItem)
                    }
                } else if (!poItem.msgstr[0]) {
                    newTxts.push(poItem)
                }
            }
            if (newTxts.length == 0) {
                continue
            }
            if (loc === this.#config.sourceLocale || !this.#geminiQueue[loc].url) {
                await this._afterExtract(loc)
                continue
            }
            const newRequest = this.#geminiQueue[loc].add(newTxts)
            const opType = `(${newRequest ? 'new request' : 'add to request'})`
            const locName = this.#config.locales[loc].name
            console.info('Gemini translate', newTxts.length, 'items to', locName, opType)
            await this.#geminiQueue[loc].running
        }
        return {
            code: prep.mstr.toString(),
            map: prep.mstr.generateMap(),
        }
    }

    configResolved = async (config: { env: { DEV?: boolean, PROD?: boolean, EXTRACT?: boolean; }, root: string; }) => {
        if (config.env.EXTRACT) {
            this.#currentPurpose = 'extract'
        } else if (config.env.DEV) {
            this.#currentPurpose = 'dev'
        } else if (config.env.PROD == null) {
            this.#currentPurpose = "test"
            for (const loc of this._locales) {
                this._translations[loc] = {}
                this._compiled[loc] = []
            }
            this.#sourceTranslations = this._translations[this.#config.sourceLocale]
        } else {
            this.#currentPurpose = 'prod'
        }
        this.#projectRoot = config.root
        // for transform
        for (const pattern of this.#config.files) {
            this.#patterns.push(pm(...this.#globOptsToArgs(pattern)))
        }
        // for handleHotUpdate below
        this.#transFnamesToLocales = Object.fromEntries(
            Object.entries(this.#translationsFname)
                .map(([loc, fname]) => [normalize(this.#projectRoot + '/' + fname), loc]),
        )
        await this.#loadFilesAndSetup()
    }

    configureServer = (server: ViteDevServer) => {
        this.#server = server
        // initial load
        server.ws.on(`${pluginName}:get`, (msg: { locale: string }, client) => {
            client.send(`${pluginName}:update`, {
                locale: msg.locale,
                data: this._compiled[msg.locale],
            })
        })
    }

    handleHotUpdate = async (ctx: ViteHotUpdateCTX) => {
        // PO file write -> JS HMR
        if (!(ctx.file in this.#transFnamesToLocales)) {
            return
        }
        const loc = this.#transFnamesToLocales[ctx.file]
        await this.#loadTranslations(loc)
        this.#compile(loc)
        this.#server.ws.send(`${pluginName}:update`, { locale: loc, data: this._compiled[loc] })
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
        const pluralRuleExport = `export const pluralsRule = n => ${this.#config.locales[locale].pluralRule}\n`
        return `${pluralRuleExport}export default ${JSON.stringify(this._compiled[locale])}`
    }

    _transformHandler = async (code: string, id: string) => {
        const filename = relative(this.#projectRoot, id)
        if (!this.#patterns.find(isMatch => isMatch(filename))) {
            return
        }
        const isModule = moduleEnd.find(p => id.endsWith(p))
        if (!markupEnd.find(p => id.endsWith(p)) && !isModule) {
            return
        }
        let ast: AST.Root | Program
        if (isModule) {
            ast = ScriptParser.parse(code, scriptParseOptions)
        } else {
            ast = parse(code, { modern: true })
        }
        return await this.#preprocess(code, ast, filename)
    }
}

export default async function wuchale(config: Config = {}) {
    const plugin = new Plugin()
    await plugin._init(config)
    return plugin
}
