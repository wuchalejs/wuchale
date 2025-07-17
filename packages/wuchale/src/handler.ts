// $$ cd ../.. && npm run test
import { IndexTracker, NestText, type Catalog } from "./adapter.js"
import {dirname, relative, resolve} from 'node:path'
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
export type CatalogssByLocale = { [loc: string]: { [key: string]: ItemType } }

export class AdapterHandler {

    key: string

    loaderPath: string
    loader: string
    loaderSync: string

    #config: ConfigPartial
    #locales: string[]
    patterns: Matcher[] = []
    #projectRoot: string

    #adapter: Adapter

    catalogs: CatalogssByLocale = {}
    compiled: { [locale: string]: (CompiledFragment | number)[] } = {}
    #sourceCatalog: { [key: string]: ItemType }

    #compiledFname: { [loc: string]: string } = {}
    #catalogsFname: { [loc: string]: string } = {}
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

    /** Get both catalog virtual module names AND HMR event names */
    virtModEvent = (locale: string) => `${virtualPrefix}catalog/${this.key}/${locale}`

    async writeInitialLoader() {
        // write the initial loader, but not if it already exists
        const catalogToLoader = this.#adapter.catalog.replace('{locale}', 'loader')
        this.loaderPath = resolve(catalogToLoader) + this.#adapter.compiledExt
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

    init = async (catalogs?: CatalogssByLocale) => {
        for (const pattern of this.#adapter.files) {
            this.patterns.push(pm(...this.#globOptsToArgs(pattern)))
        }
        this.#locales = Object.keys(this.#config.locales)
            .sort(loc => loc === this.#config.sourceLocale ? -1 : 1)
        const sourceLocaleName = this.#config.locales[this.#config.sourceLocale].name
        this.transFnamesToLocales = {}
        await this.writeInitialLoader()
        this.#prepLoaders()
        for (const loc of this.#locales) {
            // all of them before loadCatalogNCompile
            this.catalogs[loc] = {}
            this.compiled[loc] = []
            const catalog = this.#adapter.catalog.replace('{locale}', loc)
            const catalogFname = `${catalog}.po`
            this.#catalogsFname[loc] = catalogFname
            this.#compiledFname[loc] = `${catalog}${this.#adapter.compiledExt}`
            if (catalogs) {
                this.catalogs[loc] = catalogs[loc]
            }
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
                    async () => await this.afterExtract(loc),
                )
            }
        }
        if (this.#mode === 'test') {
            return
        }
        for (const loc of this.#locales) {
            if (catalogs == null) {
                await this.loadCatalogNCompile(loc)
            } else {
                this.compile(loc)
            }
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
            console.info(`i18n stats (${this.key}, ${locName}): total: ${total}, untranslated: ${untranslated}`)
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

    loadDataModule = (locale: string) => `
        export const key = '${this.key}'
        export const pluralsRule = n => ${this.#config.locales[locale].pluralRule}
        export default ${JSON.stringify(this.compiled[locale])}
    `

    compile = (loc: string) => {
        this.compiled[loc] = []
        for (const key in this.catalogs[loc]) {
            const poItem = this.catalogs[loc][key]
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
            await savePO(Object.values(this.catalogs[loc]), this.#catalogsFname[loc], this.#fullHeaders(loc))
        }
        if (this.#mode !== 'extract') {
            this.compile(loc)
        }
    }

    transform = async (content: string, filename: string) => {
        let loaderPathRel = relative(dirname(filename), this.loaderPath)
        if (!loaderPathRel.startsWith('.')) {
            loaderPathRel = `./${loaderPathRel}`
        }
        const {txts, ...output} = this.#adapter.transform(content, filename, this.#indexTracker, loaderPathRel)
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
