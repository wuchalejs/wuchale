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
    obsolete: number,
    headers: { [key: string]: string },
}

async function loadPOFile(filename: string): Promise<LoadedPO> {
    return new Promise((res, rej) => {
        PO.load(filename, (err, po) => {
            const catalog: Catalog = {}
            let total = 0
            let untranslated = 0
            let obsolete = 0
            if (err) {
                rej(err)
                return
            }
            for (const item of po.items) {
                total++
                if (!item.msgstr[0]) {
                    untranslated++
                }
                if (item.obsolete) {
                    obsolete++
                }
                const nTxt = new NestText([item.msgid, item.msgid_plural], null, item.msgctxt)
                catalog[nTxt.toKey()] = item
            }
            res({ catalog: catalog, total, untranslated, obsolete, headers: po.headers })
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
type CompiledCatalog = { [loc: string]: CompiledItems }
type PerFileState = {
    id: string,
    compiled: CompiledCatalog,
    indexTracker: IndexTracker,
}

export class AdapterHandler {

    key: string
    loaderPath: string

    #config: ConfigPartial
    #locales: string[]
    patterns: Matcher[] = []
    #projectRoot: string

    #adapter: Adapter

    catalogs: { [loc: string]: { [key: string]: ItemType } } = {}
    compiled: CompiledCatalog = {}

    perFileState: {[filename: string]: PerFileState} = {}
    perFileStateByID: {[id: string]: PerFileState} = {}

    #catalogsFname: { [loc: string]: string } = {}
    transFnamesToLocales: { [key: string]: string } = {}

    #poHeaders: { [loc: string]: { [key: string]: string } } = {}

    #mode: Mode
    #indexTracker: IndexTracker = new IndexTracker()
    #geminiQueue: { [loc: string]: GeminiQueue } = {}

    constructor(adapter: Adapter, key: string | number, config: ConfigPartial, mode: Mode, projectRoot: string) {
        this.#adapter = adapter
        this.key = key.toString()
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
        if (this.#mode !== 'test') {
            await copyFile(this.#adapter.loaderTemplateFile, this.loaderPath)
        }
    }

    /** Get both catalog virtual module names AND HMR event names */
    virtModEvent = (locale: string, fileID: string | null) => `${virtualPrefix}catalog/${this.key}/${fileID ?? this.key}/${locale}`

    getLoader() {
        let fileIDs = [this.key]
        if (this.#adapter.perFile) {
            fileIDs = Object.values(this.perFileState).filter(f => f.compiled[this.#config.sourceLocale].length > 0).map(f => f.id)
        }
        const imports = []
        for (const id of fileIDs) {
            const importsByLocale = []
            for (const loc of this.#locales) {
                importsByLocale.push(`${loc}: () => import('${this.virtModEvent(loc, id)}')`)
            }
            imports.push(`${id}: {${importsByLocale.join(',')}}`)
        }
        return `
            const catalogs = {${imports.join(',')}}
            export const fileIDs = ['${fileIDs.join("', '")}']
            export const loadCatalog = (fileID, locale) => catalogs[fileID][locale]()
        `
    }

    getLoaderSync() {
        let fileIDs = [this.key]
        if (this.#adapter.perFile) {
            fileIDs = Object.values(this.perFileState).filter(f => f.compiled[this.#config.sourceLocale].length > 0).map(f => f.id)
        }
        const imports = []
        const object = []
        for (const id of fileIDs) {
            const importedByLocale = []
            for (const loc of this.#locales) {
                imports.push(`import * as ${loc}Of${id} from '${this.virtModEvent(loc, id)}'`)
                importedByLocale.push(this.#locales.map(loc => `${loc}: ${loc}Of${id}`))
            }
            object.push(`${id}: {${importedByLocale.join(',')}}`)
        }
        return `
            ${imports.join('\n')}
            const catalogs = {${object.join(',')}}
            export const fileIDs = ['${fileIDs.join("', '")}']
            export const loadCatalog = (fileID, locale) => catalogs[fileID][locale]
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
        for (const loc of this.#locales) {
            this.catalogs[loc] = {}
            const catalog = this.#adapter.catalog.replace('{locale}', loc)
            const catalogFname = `${catalog}.po`
            this.#catalogsFname[loc] = catalogFname
            // for handleHotUpdate
            this.transFnamesToLocales[normalize(this.#projectRoot + '/' + catalogFname)] = loc
            if (loc !== this.#config.sourceLocale && this.#mode !== 'test') {
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
            const { catalog, total, untranslated, obsolete, headers } = await loadPOFile(this.#catalogsFname[loc])
            this.#poHeaders[loc] = headers
            this.catalogs[loc] = catalog
            const locName = this.#config.locales[loc].name
            let catPath = this.#adapter.catalog.replace('{locale}', locName)
            if (catPath.startsWith('./')) {
                catPath = catPath.slice(2)
            }
            if (catPath.endsWith('/')) {
                catPath = catPath.slice(0, -1)
            }
            console.info(`i18n stats (${catPath}): total: ${total}, untranslated: ${untranslated}, obsolete: ${obsolete}`)
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

    loadDataModule = (locale: string, fileID: string) => {
        let compiledItems = this.compiled[locale]
        if (this.#adapter.perFile) {
            compiledItems = this.perFileStateByID[fileID]?.compiled?.[locale] ?? []
        }
        const compiled = JSON.stringify(compiledItems)
        const plural = `n => ${this.#config.locales[locale].plural}`
        if (this.#mode === 'dev') {
            const eventSend = this.virtModEvent(locale, fileID)
            const eventReceive = this.virtModEvent(locale, null)
            return this.#adapter.proxyModuleDev(fileID, eventSend, eventReceive, compiled, plural)
        }
        return `
            export const plural = ${plural}
            export const data = ${compiled}
        `
    }

    #getStatePerFile(filename: string): PerFileState {
        let state = this.perFileState[filename]
        if (state == null) {
            state = {
                id: Object.keys(this.perFileState).length.toString(),
                compiled: Object.fromEntries(this.#locales.map(loc => [loc, []])),
                indexTracker: new IndexTracker(),
            }
            this.perFileState[filename] = state
            this.perFileStateByID[state.id] = state
        }
        return state
    }

    compile = (loc: string) => {
        this.compiled[loc] = []
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
                const state = this.#getStatePerFile(fname)
                state.compiled[loc][state.indexTracker.get(key)] = compiled
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
        let fileID = this.key
        if (this.#adapter.perFile) {
            const state = this.#getStatePerFile(filename)
            indexTracker = state.indexTracker
            fileID = state.id
        }
        let loaderPath = relative(dirname(filename), this.loaderPath)
        if (!loaderPath.startsWith('.')) {
            loaderPath = `./${loaderPath}`
        }
        const {txts, ...output} = this.#adapter.transform(content, filename, indexTracker, loaderPath, fileID)
        for (const loc of this.#locales) {
            // clear references to this file first
            let previousReferences: {[key: string]: number} = {}
            let fewerRefs = false
            for (const item of Object.values(this.catalogs[loc])) {
                if (!item.references.includes(filename)) {
                    continue
                }
                const key = new NestText([item.msgid, item.msgid_plural], null, item.msgctxt).toKey()
                const prevRefs = item.references.length
                item.references = item.references.filter(f => f !== filename)
                previousReferences[key] = prevRefs - item.references.length
                item.obsolete = item.references.length === 0
                fewerRefs = true
            }
            if (!txts.length) {
                if (fewerRefs) {
                    this.savePoAndCompile(loc)
                }
                continue
            }
            const newTxts: ItemType[] = []
            let newRefs = false
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
                if (previousReferences[key] > 0) {
                    if (previousReferences[key] === 1) {
                        delete previousReferences[key]
                    } else {
                        previousReferences[key]--
                    }
                } else {
                    newRefs = true // now it references it
                }
                poItem.references.push(filename)
                poItem.obsolete = false
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
            if (newTxts.length === 0) {
                if (newRefs || Object.keys(previousReferences).length) { // or unused refs
                    await this.savePoAndCompile(loc)
                }
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
        if (!txts.length) {
            return {}
        }
        return output
    }
}
