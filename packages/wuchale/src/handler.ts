// $$ cd ../.. && npm run test
import { basename, dirname, relative, resolve } from 'node:path'
import { IndexTracker, NestText } from "./adapters.js"
import type { Adapter, GlobConf, Catalog, Logger } from "./adapters.js"
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

export type Mode = 'dev' | 'prod' | 'extract'
type CompiledItems = (CompiledFragment | number)[]
type Compiled = {
    hasPlurals: boolean
    items: CompiledItems
}
type CompiledCatalog = { [loc: string]: Compiled }
type GranularState = {
    id: string,
    compiled: CompiledCatalog,
    indexTracker: IndexTracker,
}

export class AdapterHandler {

    key: string

    // paths
    loaderPath: string
    proxyPath: string
    outDir: string
    compiledHead: {[loc: string]: string} = {}

    #config: ConfigPartial
    #locales: string[]
    fileMatches: Matcher
    #projectRoot: string

    #adapter: Adapter

    catalogs: { [loc: string]: { [key: string]: ItemType } } = {}
    compiled: CompiledCatalog = {}

    granularStateByFile: { [filename: string]: GranularState } = {}
    granularStateByID: { [id: string]: GranularState } = {}

    #catalogsFname: { [loc: string]: string } = {}
    catalogPathsToLocales: { [key: string]: string } = {}

    #poHeaders: { [loc: string]: { [key: string]: string } } = {}

    #mode: Mode
    #indexTracker: IndexTracker = new IndexTracker()
    #geminiQueue: { [loc: string]: GeminiQueue } = {}

    #log: Logger

    constructor(adapter: Adapter, key: string | number, config: ConfigPartial, mode: Mode, projectRoot: string, log: Logger) {
        this.#adapter = adapter
        this.key = key.toString()
        this.#mode = mode
        this.#projectRoot = projectRoot
        this.#config = config
        this.#log = log
    }

    getLoaderPaths(): string[] {
        const catalogToLoader = this.#adapter.catalog.replace('{locale}', 'loader')
        const paths: string[] = []
        for (const ext of this.#adapter.loaderExts) {
            let path = catalogToLoader + ext
            if (path.startsWith('./')) {
                path = path.slice(2)
            }
            paths.push(path)
        }
        return paths
    }

    async getLoaderPath(): Promise<{path: string | null, empty: boolean}> {
        for (const path of this.getLoaderPaths()) {
            try {
                const contents = await readFile(path)
                return {path, empty: contents.toString().trim() === ''}
            } catch (err: any) {
                if (err.code !== 'ENOENT') {
                    throw err
                }
                continue
            }
        }
        return {path: null, empty: true}
    }

    async #initPaths() {
        const {path: loaderPath, empty} = await this.getLoaderPath()
        if (!loaderPath || empty) {
            throw new Error('No valid loader file found.')
        }
        this.loaderPath = loaderPath
        this.proxyPath = this.#adapter.catalog.replace('{locale}', 'proxy') + this.#adapter.loaderExts[0]
        this.outDir = this.#adapter.writeFiles.outDir
        if (!this.outDir) {
            this.outDir = this.#adapter.catalog.replace('{locale}', '.output')
        }
        for (const loc of this.#locales) {
            this.compiledHead[loc] = this.#adapter.catalog.replace('{locale}', loc) + '.compiled.' // + id + ext
        }
    }

    /** Get both catalog virtual module names AND HMR event names */
    virtModEvent = (locale: string, loadID: string | null) => `${virtualPrefix}catalog/${this.key}/${loadID ?? this.key}/${locale}`

    #getFileIDs() {
        if (!this.#adapter.granularLoad) {
            return [this.key]
        }
        return Object.values(this.granularStateByFile)
            .filter(f => f.compiled[this.#config.sourceLocale].items.length > 0)
            .map(f => f.id)
    }

    #getCompiledFilePath(loc: string, id: string | null) {
        return this.compiledHead[loc] + (id ?? this.key) + this.#adapter.loaderExts[0]
    }

    #getCompiledImport(loc: string, id: string | null, proxyFilePath?: string) {
        if (proxyFilePath) {
            return './' + basename(this.#getCompiledFilePath(loc, id))
        }
        return this.virtModEvent(loc, id)
    }

    #loaderLoadIDsNKey(loadIDs: string[]) {
        return `
            export const loadIDs = ['${loadIDs.join("', '")}']
            export const key = '${this.key}'
        `
    }

    getProxy(proxyFilePath?: string) {
        const imports = []
        const loadIDs = this.#getFileIDs()
        for (const id of loadIDs) {
            const importsByLocale = []
            for (const loc of this.#locales) {
                importsByLocale.push(`${loc}: () => import('${this.#getCompiledImport(loc, id, proxyFilePath)}')`)
            }
            imports.push(`${id}: {${importsByLocale.join(',')}}`)
        }
        return `
            const catalogs = {${imports.join(',')}}
            export const loadCatalog = (loadID, locale) => catalogs[loadID][locale]()
            ${this.#loaderLoadIDsNKey(loadIDs)}
        `
    }

    getProxySync(proxyFilePath?: string) {
        const loadIDs = this.#getFileIDs()
        const imports = []
        const object = []
        for (const id of loadIDs) {
            const importedByLocale = []
            for (const loc of this.#locales) {
                imports.push(`import * as ${loc}Of${id} from '${this.#getCompiledImport(loc, id, proxyFilePath)}'`)
                importedByLocale.push(`${loc}: ${loc}Of${id}`)
            }
            object.push(`${id}: {${importedByLocale.join(',')}}`)
        }
        return `
            ${imports.join('\n')}
            const catalogs = {${object.join(',')}}
            export const loadCatalog = (loadID, locale) => catalogs[loadID][locale]
            ${this.#loaderLoadIDsNKey(loadIDs)}
        `
    }

    init = async () => {
        this.#locales = Object.keys(this.#config.locales)
            .sort(loc => loc === this.#config.sourceLocale ? -1 : 1)
        await this.#initPaths()
        this.fileMatches = pm(...this.#globConfToArgs(this.#adapter.files))
        const sourceLocaleName = this.#config.locales[this.#config.sourceLocale].name
        this.catalogPathsToLocales = {}
        for (const loc of this.#locales) {
            this.catalogs[loc] = {}
            const catalog = this.#adapter.catalog.replace('{locale}', loc)
            const catalogFname = `${catalog}.po`
            this.#catalogsFname[loc] = catalogFname
            // for handleHotUpdate
            this.catalogPathsToLocales[normalize(this.#projectRoot + '/' + catalogFname)] = loc
            if (loc !== this.#config.sourceLocale) {
                this.#geminiQueue[loc] = new GeminiQueue(
                    sourceLocaleName,
                    this.#config.locales[loc].name,
                    this.#config.geminiAPIKey,
                    async () => await this.savePoAndCompile(loc),
                )
            }
            await this.loadCatalogNCompile(loc)
        }
        await this.writeProxy()
    }

    directExtract = async () => {
        const all = []
        const extract = async (file: string) => {
            const contents = await readFile(file)
            await this.transform(contents.toString(), file)
        }
        for (const file of await glob(...this.#globConfToArgs(this.#adapter.files))) {
            this.#log.info(`Extract from ${file}`)
            all.push(extract(file))
        }
        await Promise.all(all)
    }

    loadCatalogNCompile = async (loc: string) => {
        try {
            const { catalog, total, untranslated, obsolete, headers } = await loadPOFile(this.#catalogsFname[loc])
            this.#poHeaders[loc] = headers
            this.catalogs[loc] = catalog
            const locName = this.#config.locales[loc].name
            this.#log.info(`i18n stats (${this.key}/${locName}): total: ${total}, untranslated: ${untranslated}, obsolete: ${obsolete}`)
            this.compile(loc)
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err
            }
            this.#log.warn(`${this.key}: Catalog for ${loc} not found.`)
        }
    }

    loadDataModule = (locale: string, loadID: string) => {
        let compiledData = this.compiled[locale]
        if (this.#adapter.granularLoad) {
            compiledData = this.granularStateByID[loadID]?.compiled?.[locale] ?? {hasPlurals: false, items: []}
        }
        const compiledItems = JSON.stringify(compiledData.items)
        const plural = `n => ${this.#config.locales[locale].plural}`
        if (this.#mode === 'dev') {
            const eventSend = this.virtModEvent(locale, loadID)
            const eventReceive = this.virtModEvent(locale, null)
            return this.#adapter.dataModuleDev({ loadID: loadID, eventSend, eventReceive, compiled: compiledItems, plural })
        }
        return `
            export const c = ${compiledItems}
            ${compiledData.hasPlurals && `export const p = ${plural}`}
        `
    }

    #getGranularState(filename: string): GranularState {
        let state = this.granularStateByFile[filename]
        if (state == null) {
            const id = this.#adapter.generateLoadID(filename)
            if (id in this.granularStateByID) {
                state = this.granularStateByID[id]
            } else {
                state = {
                    id,
                    compiled: Object.fromEntries(this.#locales.map(loc => [loc, {
                        hasPlurals: false,
                        items: []
                    }])),
                    indexTracker: new IndexTracker(),
                }
                this.granularStateByID[id] = state
            }
            this.granularStateByFile[filename] = this.granularStateByID[id]
        }
        return state
    }

    compile = async (loc: string) => {
        this.compiled[loc] = {hasPlurals: false, items: []}
        for (const key in this.catalogs[loc]) {
            const poItem = this.catalogs[loc][key]
            const index = this.#indexTracker.get(key)
            let compiled: CompiledFragment
            const fallback = this.compiled[this.#config.sourceLocale]?.items?.[index] // ?. for sourceLocale itself
            if (poItem.msgid_plural) {
                this.compiled[loc].hasPlurals = true
                if (poItem.msgstr.join('').trim()) {
                    compiled = poItem.msgstr
                } else {
                    compiled = fallback
                }
            } else {
                compiled = compileTranslation(poItem.msgstr[0], fallback)
            }
            this.compiled[loc].items[index] = compiled
            if (!this.#adapter.granularLoad) {
                continue
            }
            for (const fname of poItem.references) {
                const state = this.#getGranularState(fname)
                state.compiled[loc].hasPlurals = this.compiled[loc].hasPlurals
                state.compiled[loc].items[state.indexTracker.get(key)] = compiled
            }
        }
        await this.writeCompiled(loc)
    }

    writeCompiled = async (loc: string) => {
        if (!this.#adapter.writeFiles.compiled) {
            return
        }
        await writeFile(this.#getCompiledFilePath(loc, null), this.loadDataModule(loc, null))
        if (!this.#adapter.granularLoad) {
            return
        }
        for (const state of Object.values(this.granularStateByID)) {
            await writeFile(this.#getCompiledFilePath(loc, state.id), this.loadDataModule(loc, state.id))
        }
    }

    writeProxy = async () => {
        if (!this.#adapter.writeFiles.proxy) {
            return
        }
        await writeFile(this.proxyPath, this.getProxySync(this.proxyPath))
    }

    writeTransformed = async (filename: string, content: string) => {
        if (!this.#adapter.writeFiles.transformed) {
            return
        }
        const fname = resolve(this.outDir + '/' + filename)
        await mkdir(dirname(fname), {recursive: true})
        await writeFile(fname, content)
    }

    #globConfToArgs = (conf: GlobConf): [string[], { ignore: string[] }] => {
        let patterns: string[] = []
        // ignore generated files
        const options = { ignore: [this.loaderPath] }
        if (this.#adapter.writeFiles.proxy) {
            options.ignore.push(this.proxyPath)
        }
        if (this.#adapter.writeFiles.outDir) {
            options.ignore.push(this.outDir + '*')
        }
        if (this.#adapter.writeFiles.compiled) {
            for (const loc of this.#locales) {
                options.ignore.push(this.compiledHead[loc] + '*')
            }
        }
        if (typeof conf === 'string') {
            patterns = [conf]
        } else if (Array.isArray(conf)) {
            patterns = conf
        } else {
            if (typeof conf.include === 'string') {
                patterns.push(conf.include)
            } else {
                patterns = conf.include
            }
            if (typeof conf.ignore === 'string') {
                options.ignore.push(conf.ignore)
            } else {
                options.ignore.push(...conf.ignore)
            }
        }
        return [patterns, options]
    }

    savePoAndCompile = async (loc: string) => {
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
        await savePO(Object.values(this.catalogs[loc]), this.#catalogsFname[loc], fullHead)
        if (this.#mode !== 'extract') { // save for the end
            await this.compile(loc)
        }
    }

    transform = async (content: string, filename: string): Promise<{code?: string, map?: any, catalogChanged?: boolean}> => {
        let indexTracker = this.#indexTracker
        let loadID = this.key
        if (this.#adapter.granularLoad) {
            const state = this.#getGranularState(filename)
            indexTracker = state.indexTracker
            loadID = state.id
        }
        let loaderRelTo = filename
        if (this.#adapter.writeFiles.transformed) {
            loaderRelTo = resolve(this.outDir + '/' + filename)
        }
        let loaderPath = relative(dirname(loaderRelTo), this.loaderPath)
        if (!loaderPath.startsWith('.')) {
            loaderPath = `./${loaderPath}`
        }
        const { txts, ...output } = this.#adapter.transform({
            content,
            filename,
            index: indexTracker,
            loaderPath,
            loadID: loadID,
            key: this.key,
            locales: this.#locales,
        })
        let catalogChanged = false
        for (const loc of this.#locales) {
            // clear references to this file first
            let previousReferences: { [key: string]: number } = {}
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
            let newItems: boolean = false
            const untranslated: ItemType[] = []
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
                    newItems = true
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
                        untranslated.push(poItem)
                    }
                } else if (!poItem.msgstr[0]) {
                    untranslated.push(poItem)
                }
            }
            if (untranslated.length === 0) {
                if (newRefs || Object.keys(previousReferences).length) { // or unused refs
                    await this.savePoAndCompile(loc)
                }
                continue
            }
            catalogChanged = true
            if (loc === this.#config.sourceLocale || !this.#geminiQueue[loc]?.url) {
                if (newItems) {
                    await this.savePoAndCompile(loc)
                }
                continue
            }
            const newRequest = this.#geminiQueue[loc].add(untranslated)
            const opType = `(${newRequest ? 'new request' : 'add to request'})`
            const locName = this.#config.locales[loc].name
            this.#log.info(`Gemini translate ${untranslated.length} items to ${locName} ${opType}`)
            await this.#geminiQueue[loc].running
        }
        await this.writeTransformed(filename, output.code ?? content)
        if (!txts.length) {
            return {}
        }
        return {...output, catalogChanged}
    }
}
