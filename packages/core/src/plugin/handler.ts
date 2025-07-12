// $$ cd ../.. && npm run test
import { IndexTracker, NestText, type Translations } from "./adapter.js"
import type { Adapter, GlobConf } from "./adapter.js"
import { writeFile, readFile } from 'node:fs/promises'
import compileTranslation, { type CompiledFragment } from "./compile.js"
import GeminiQueue, { type ItemType } from "./gemini.js"
import { glob } from "tinyglobby"
import pm, { type Matcher } from 'picomatch'
import PO from "pofile"
import { normalize } from "node:path"
import { type ConfigPartial } from "../config.js"

export const pluginName = 'wuchale'
export const virtualPrefix = `virtual:${pluginName}/`

interface LoadedPO {
    translations: Translations,
    total: number,
    untranslated: number,
    headers: { [key: string]: string },
}

async function loadPOFile(filename: string): Promise<LoadedPO> {
    return new Promise((res, rej) => {
        PO.load(filename, (err, po) => {
            const translations: Translations = {}
            let total = 0
            let untranslated = 0
            if (err) {
                rej(err)
                return
            }
            for (const item of po.items) {
                total++
                if (!item.msgstr[0]) {
                    untranslated++
                }
                const nTxt = new NestText([item.msgid, item.msgid_plural], null, item.msgctxt)
                translations[nTxt.toKey()] = item
            }
            res({ translations, total, untranslated, headers: po.headers })
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

export type Mode = 'dev' | 'prod' | 'extract' | 'test'
export type TranslationsByLocale = { [loc: string]: { [key: string]: ItemType } }
export type CompiledByLocale = { [locale: string]: (CompiledFragment | number)[] }

export class AdapterHandler {

    key: string

    #config: ConfigPartial
    #locales: string[]
    patterns: Matcher[] = []
    #projectRoot: string

    #adapter: Adapter

    translations: TranslationsByLocale = {}
    compiled: CompiledByLocale = {}
    #sourceTranslations: { [key: string]: ItemType }

    #compiledFname: { [loc: string]: string } = {}
    #translationsFname: { [loc: string]: string } = {}
    transFnamesToLocales: { [key: string]: string } = {}

    #poHeaders: { [loc: string]: { [key: string]: string } } = {}

    #mode: Mode
    #indexTracker: IndexTracker
    #geminiQueue: { [loc: string]: GeminiQueue } = {}

    constructor(adapter: Adapter, key: string, config: ConfigPartial, indexTracker: IndexTracker, mode: Mode, projectRoot: string) {
        this.key = key
        this.#adapter = adapter
        this.#indexTracker = indexTracker
        this.#mode = mode
        this.#projectRoot = projectRoot
        this.#config = config
    }

    /** Get both virtual module names AND HMR event names */
    virtModEvent = (locale: string) => `${virtualPrefix}${locale}:${this.key}`

    init = async (translations?: TranslationsByLocale, compiled?: CompiledByLocale) => {
        for (const pattern of this.#adapter.files) {
            this.patterns.push(pm(...this.#globOptsToArgs(pattern)))
        }
        this.#locales = [
            this.#config.sourceLocale,
            ...Object.keys(this.#config.locales).filter(loc => loc != this.#config.sourceLocale),
        ]
        const sourceLocaleName = this.#config.locales[this.#config.sourceLocale].name
        this.transFnamesToLocales = {}
        for (const loc of this.#locales) {
            const catalog = this.#adapter.catalog.replace('{locale}', loc)
            const translFname = `${catalog}.po`
            this.#translationsFname[loc] = translFname
            this.#compiledFname[loc] = `${catalog}.svelte.js`
            this.translations[loc] = translations?.[loc] ?? {}
            this.compiled[loc] = compiled?.[loc] ?? []
            // for handleHotUpdate
            this.transFnamesToLocales[normalize(this.#projectRoot + '/' + translFname)] = loc
            if (loc === this.#config.sourceLocale) {
                continue
            }
            this.#geminiQueue[loc] = new GeminiQueue(
                sourceLocaleName,
                this.#config.locales[loc].name,
                this.#config.geminiAPIKey,
                async () => await this.afterExtract(loc),
            )
            if (this.#mode === 'test' || translations != null) {
                continue
            }
            await this.loadTranslations(loc)
            this.compile(loc)
        }
        this.#sourceTranslations = this.translations[this.#config.sourceLocale] ?? {}
        this.#indexTracker.reload(this.#sourceTranslations)
        if (this.#mode === 'test') {
            return
        }
        for (const loc of this.#locales) {
            const proxyMode = this.#mode === 'dev' ? 'dev' : 'other'
            const proxyModule = this.#adapter.proxyModule[proxyMode](this.virtModEvent(loc))
            await writeFile(this.#compiledFname[loc], proxyModule)
        }
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

    directExtract = async () => {
        const all = []
        for (const pattern of this.#adapter.files) {
            for (const file of await glob(...this.#globOptsToArgs(pattern))) {
                console.log('Extract from', file)
                const contents = await readFile(file)
                const promise = this.transform(contents.toString(), normalize(process.cwd() + '/' + file))
                all.push(promise)
            }
        }
        await Promise.all(all)
    }

    loadTranslations = async (loc: string) => {
        try {
            const { translations: trans, total, untranslated, headers } = await loadPOFile(this.#translationsFname[loc])
            this.#poHeaders[loc] = headers
            this.translations[loc] = trans
            const locName = this.#config.locales[loc].name
            console.info(`i18n stats (${this.key}, ${locName}): total: ${total}, untranslated: ${untranslated}`)
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err
            }
            if (this.#mode === 'dev' || this.#mode === 'prod') {
                await this.directExtract()
            }
        }
    }

    loadDataModule = (locale: string) => {
        const pluralRuleExport = `export const pluralsRule = n => ${this.#config.locales[locale].pluralRule}\n`
        return `${pluralRuleExport}export default ${JSON.stringify(this.compiled[locale])}`
    }

    compile = (loc: string) => {
        this.compiled[loc] = []
        for (const key in this.translations[loc]) {
            const poItem = this.translations[loc][key]
            const index = this.#indexTracker.get(key)
            let compiled: CompiledFragment
            const fallback = this.compiled[this.#config.sourceLocale][index]
            if (poItem.msgid_plural) {
                if (poItem.msgstr.join('').trim()) {
                    compiled = poItem.msgstr
                } else {
                    compiled = fallback
                }
            } else {
                compiled = compileTranslation(poItem.msgstr[0], fallback)
            }
            this.compiled[loc][index] = compiled
        }
        for (const [i, item] of this.compiled[loc].entries()) {
            if (item == null) {
                this.compiled[loc][i] = 0 // reduce json size
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

    afterExtract = async (loc: string) => {
        if (this.#mode !== 'test') {
            await savePO(Object.values(this.translations[loc]), this.#translationsFname[loc], this.#fullHeaders(loc))
        }
        if (this.#mode !== 'extract') {
            this.compile(loc)
        }
    }

    transform = async (content: string, filename: string) => {
        const {txts, ...output} = this.#adapter.transform(content, filename, this.#indexTracker, this.key)
        if (!txts.length) {
            return {}
        }
        for (const loc of this.#locales) {
            const newTxts: ItemType[] = []
            for (const nTxt of txts) {
                let key = nTxt.toKey()
                let poItem = this.translations[loc][key]
                if (!poItem) {
                    // @ts-ignore
                    poItem = new PO.Item({ nplurals: this.#config.locales[loc].nPlurals })
                    poItem.msgid = nTxt.text[0]
                    if (nTxt.plural) {
                        poItem.msgid_plural = nTxt.text[1] ?? nTxt.text[0]
                    }
                    this.translations[loc][key] = poItem
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
                await this.afterExtract(loc)
                continue
            }
            const newRequest = this.#geminiQueue[loc].add(newTxts)
            const opType = `(${newRequest ? 'new request' : 'add to request'})`
            const locName = this.#config.locales[loc].name
            console.info('Gemini translate', newTxts.length, 'items to', locName, opType)
            await this.#geminiQueue[loc].running
        }
        return output
    }
}
