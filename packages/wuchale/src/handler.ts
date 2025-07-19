// $$ cd ../.. && npm run test
import { IndexTracker, NestText, type Catalog } from "./adapter.js"
import {dirname, relative} from 'node:path'
import type { Adapter, GlobConf } from "./adapter.js"
import { readFile, copyFile } from 'node:fs/promises'
import { compileTranslation, type CompiledFragment } from "./compile.js"
import GeminiQueue, { type ItemType } from "./gemini.js"
import { glob } from "tinyglobby"
import pm, { type Matcher } from 'picomatch'
import PO from "pofile"
import { normalize } from "node:path"
import { type ConfigPartial } from "./config.js"

export const pluginName = 'wuchale'
export const virtualPrefix = `virtual:${pluginName}/`

interface LoadedPO {
    catalog: Catalog,
    total: number,
    untranslated: number,
    headers: { [key: string]: string },
}

async function loadPOFile(filename: string): Promise<LoadedPO> {
    return new Promise((res, rej) => {
        PO.load(filename, (err, po) => {
            const catalog: Catalog = {}
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
                catalog[nTxt.toKey()] = item
            }
            res({ catalog: catalog, total, untranslated, headers: po.headers })
        })
    })
}

async function savePO(items: ItemType[], filename: string, headers = {}): Promise<void> {
    const po = new PO()
    po.headers = headers
    for (const item of Object.values(items)) {
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
type CompiledItems = (CompiledFragment | number)[]

export class AdapterHandler {

    loaderPath: string
    loader: string
    loaderSync: string

    #config: ConfigPartial
    #locales: string[]
    patterns: Matcher[] = []
    #projectRoot: string

    #adapter: Adapter

    catalogs: { [loc: string]: { [key: string]: ItemType } } = {}
    compiled: { [loc: string]: CompiledItems } = {}
    compiledPerFile: {[loc: string]: {[filename: string]: CompiledItems}} = {}
    #sourceCatalog: { [key: string]: ItemType }

    #catalogsFname: { [loc: string]: string } = {}
    transFnamesToLocales: { [key: string]: string } = {}

    #poHeaders: { [loc: string]: { [key: string]: string } } = {}

    #mode: Mode
    #indexTracker: IndexTracker = new IndexTracker()
    #indexTrackerPerFile: {[filename: string]: IndexTracker} = {}
    #geminiQueue: { [loc: string]: GeminiQueue } = {}

    constructor(adapter: Adapter, config: ConfigPartial, mode: Mode, projectRoot: string) {
        this.#adapter = adapter
        this.#mode = mode
        this.#projectRoot = projectRoot
        this.#config = config
    }

    async #initLoader() {
        // write the initial loader, but not if it already exists
        const catalogToLoader = this.#adapter.catalog.replace('{locale}', 'loader')
        this.loaderPath = catalogToLoader + this.#adapter.loaderExt
        if (this.loaderPath.startsWith('./')) {
            this.loaderPath = this.loaderPath.slice(2)
        }
        try {
            const contents = await readFile(this.loaderPath)
            if (contents.toString().trim() !== '') {
                return
            }
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                throw err
            }
        }
        await copyFile(this.#adapter.loaderTemplateFile, this.loaderPath)
    }

    /** Get both catalog virtual module names AND HMR event names */
    virtModEvent = (locale: string) => `${virtualPrefix}catalog/${locale}`

    #prepLoaders() {
        const imports = this.#locales.map(loc => `${loc}: () => import('${this.virtModEvent(loc)}')`)
        this.loader = `
            const catalogs = {${imports.join(',')}}
            export default locale => catalogs[locale]()
        `
        const importsSync = this.#locales.map(loc => `import * as ${loc} from '${this.virtModEvent(loc)}'`)
        const object = this.#locales.map(loc => `${loc}: ${loc}`)
        this.loaderSync = `
            ${importsSync.join('\n')}
            const catalogs = {${object.join(',')}}
            export default locale => catalogs[locale]
        `
    }

    init = async () => {
        for (const pattern of this.#adapter.files) {
            this.patterns.push(pm(...this.#globOptsToArgs(pattern)))
        }
        this.#locales = Object.keys(this.#config.locales)
            .sort(loc => loc === this.#config.sourceLocale ? -1 : 1)
        const sourceLocaleName = this.#config.locales[this.#config.sourceLocale].name
        this.transFnamesToLocales = {}
        await this.#initLoader()
        this.#prepLoaders()
        for (const loc of this.#locales) {
            this.catalogs[loc] = {}
            const catalog = this.#adapter.catalog.replace('{locale}', loc)
            const catalogFname = `${catalog}.po`
            this.#catalogsFname[loc] = catalogFname
            // for handleHotUpdate
            this.transFnamesToLocales[normalize(this.#projectRoot + '/' + catalogFname)] = loc
            if (loc === this.#config.sourceLocale) {
                this.#sourceCatalog = this.catalogs[loc]
                this.#indexTracker.reload(this.#sourceCatalog)
            } else if (this.#mode !== 'test') {
                this.#geminiQueue[loc] = new GeminiQueue(
                    sourceLocaleName,
                    this.#config.locales[loc].name,
                    this.#config.geminiAPIKey,
                    async () => await this.savePoAndCompile(loc),
                )
            }
            await this.loadCatalogNCompile(loc)
        }
    }

    #fullHeaders = (loc: string) => {
        const localeConf = this.#config.locales[loc]
        const fullHead = { ...this.#poHeaders[loc] ?? {} }
        const updateHeaders = [
            ['Plural-Forms', `nplurals=${localeConf.nPlurals}; plural=${localeConf.plural};`],
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
        const extract = async (file: string) => {
            const contents = await readFile(file)
            await this.transform(contents.toString(), file)
        }
        for (const pattern of this.#adapter.files) {
            for (const file of await glob(...this.#globOptsToArgs(pattern))) {
                console.log('Extract from', file)
                all.push(extract(file))
            }
        }
        await Promise.all(all)
    }

    loadCatalogNCompile = async (loc: string) => {
        try {
            const { catalog, total, untranslated, headers } = await loadPOFile(this.#catalogsFname[loc])
            this.#poHeaders[loc] = headers
            this.catalogs[loc] = catalog
            const locName = this.#config.locales[loc].name
            let catPath = this.#adapter.catalog.replace('{locale}', '#')
            if (catPath.startsWith('./')) {
                catPath = catPath.slice(2)
            }
            if (catPath.endsWith('/')) {
                catPath = catPath.slice(0, -1)
            }
            console.info(`i18n stats (${catPath}, ${locName}): total: ${total}, untranslated: ${untranslated}`)
            this.compile(loc)
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err
            }
            if (this.#mode === 'dev' || this.#mode === 'prod') {
                await this.directExtract()
            }
        }
    }

    loadDataModule = (locale: string, devEvent: string, perFileImporter?: string) => {
        let compiledItems = this.compiled[locale]
        if (this.#adapter.perFile) {
            compiledItems = this.compiledPerFile[locale][perFileImporter] ?? []
        }
        const compiled = JSON.stringify(compiledItems)
        const plural = `n => ${this.#config.locales[locale].plural}`
        if (this.#mode === 'dev') {
            return this.#adapter.proxyModuleDev(devEvent, compiled, plural)
        }
        return `
            export const plural = ${plural}
            export default ${compiled}
        `
    }

    #getIndexTrackerPerFile(filename: string): IndexTracker {
        let indexTracker = this.#indexTrackerPerFile[filename]
        if (indexTracker == null) {
            indexTracker = new IndexTracker()
            this.#indexTrackerPerFile[filename] = indexTracker
        }
        return indexTracker
    }

    compile = (loc: string) => {
        this.compiled[loc] = []
        this.compiledPerFile[loc] = {}
        for (const key in this.catalogs[loc]) {
            const poItem = this.catalogs[loc][key]
            const index = this.#indexTracker.get(key)
            let compiled: CompiledFragment
            const fallback = this.compiled[this.#config.sourceLocale]?.[index] // ?. for sourceLocale itself
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
            if (!this.#adapter.perFile) {
                continue
            }
            for (const fname of poItem.references) {
                if (!(fname in this.compiledPerFile[loc])) {
                    this.compiledPerFile[loc][fname] = []
                }
                const index = this.#getIndexTrackerPerFile(fname).get(key)
                this.compiledPerFile[loc][fname][index] = compiled
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

    savePoAndCompile = async (loc: string) => {
        if (this.#mode !== 'test') {
            await savePO(Object.values(this.catalogs[loc]), this.#catalogsFname[loc], this.#fullHeaders(loc))
        }
        if (this.#mode !== 'extract') {
            this.compile(loc)
        }
    }

    transform = async (content: string, filename: string) => {
        let indexTracker = this.#indexTracker
        let loaderPathRel: string
        if (this.#adapter.perFile) {
            loaderPathRel = `${virtualPrefix}/per-file-loader`
            indexTracker = this.#getIndexTrackerPerFile(filename)
        } else {
            loaderPathRel = relative(dirname(filename), this.loaderPath)
            if (!loaderPathRel.startsWith('.')) {
                loaderPathRel = `./${loaderPathRel}`
            }
        }
        const {txts, ...output} = this.#adapter.transform(content, filename, indexTracker, loaderPathRel)
        // clear references to this file first
        for (const loc of this.#locales) {
            let newObsolete = false
            for (const item of Object.values(this.catalogs[loc])) {
                const initRefs = item.references.length
                item.references = item.references.filter(f => f !== filename)
                item.obsolete = item.references.length === 0
                if (item.references.length < initRefs) {
                    newObsolete = true
                }
            }
            if (newObsolete && !txts.length) {
                this.savePoAndCompile(loc)
            }
        }
        if (!txts.length) {
            return {}
        }
        for (const loc of this.#locales) {
            const newTxts: ItemType[] = []
            for (const nTxt of txts) {
                let key = nTxt.toKey()
                let poItem = this.catalogs[loc][key]
                if (!poItem) {
                    // @ts-ignore
                    poItem = new PO.Item({ nplurals: this.#config.locales[loc].nPlurals })
                    poItem.msgid = nTxt.text[0]
                    if (nTxt.plural) {
                        poItem.msgid_plural = nTxt.text[1] ?? nTxt.text[0]
                    }
                    this.catalogs[loc][key] = poItem
                }
                if (nTxt.context) {
                    poItem.msgctxt = nTxt.context
                }
                if (!poItem.references.includes(filename)) {
                    poItem.references.push(filename)
                    poItem.obsolete = false
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
            if (loc === this.#config.sourceLocale || !this.#geminiQueue[loc]?.url) {
                await this.savePoAndCompile(loc)
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
