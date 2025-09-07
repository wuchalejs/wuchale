// $$ cd ../.. && npm run test
import { basename, dirname, isAbsolute, resolve, normalize, relative } from 'node:path'
import { platform } from 'node:process'
import { IndexTracker, Message } from "./adapters.js"
import type { Adapter, CatalogExpr, GlobConf, HMRData, LoaderPath } from "./adapters.js"
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { compileTranslation, type CompiledElement } from "./compile.js"
import GeminiQueue, { type ItemType } from "./gemini.js"
import pm, { type Matcher } from 'picomatch'
import PO from "pofile"
import { type ConfigPartial, getLanguageName } from "./config.js"
import { color, type Logger } from './log.js'
import { catalogVarName } from './runtime.js'
import { varNames } from './adapter-utils/index.js'

type PluralRule = {
    nplurals: number
    plural: string
}

const defaultPluralRule: PluralRule = {
    nplurals: 2,
    plural: 'n == 1 ? 0 : 1',
}

type Catalog = Record<string, ItemType>

type POFile = {
    catalog: Catalog
    headers: Record<string, string>
    pluralRule: PluralRule
    loaded: boolean
}

const getFuncPlain = '_w_load_'
const getFuncReactive = getFuncPlain + 'rx_'
const catalogsVarName = '_w_catalogs_'
const bundledCatalogExpr: CatalogExpr = {
    plain: `${getFuncPlain}(${catalogsVarName})`,
    reactive: `${getFuncReactive}(${catalogsVarName})`,
}

const objKeyLocale = (locale: string) => locale.includes('-') ? `'${locale}'` : locale

export async function loadPOFile(filename: string): Promise<PO> {
    return new Promise((res, rej) => {
        PO.load(filename, (err, po) => {
            if (err) {
                rej(err)
            } else {
                res(po)
            }
        })
    })
}

async function loadCatalogFromPO(filename: string): Promise<POFile> {
    const po = await loadPOFile(filename)
    const catalog: Catalog = {}
    for (const item of po.items) {
        const msgInfo = new Message([item.msgid, item.msgid_plural], null, item.msgctxt)
        catalog[msgInfo.toKey()] = item
    }
    let pluralRule: PluralRule
    const pluralHeader = po.headers['Plural-Forms']
    if (pluralHeader) {
        pluralRule = <PluralRule><unknown>PO.parsePluralForms(pluralHeader)
        pluralRule.nplurals = Number(pluralRule.nplurals)
    } else {
        pluralRule = defaultPluralRule
    }
    return { catalog, pluralRule, headers: po.headers, loaded: true }
}

async function saveCatalogToPO(catalog: Catalog, filename: string, headers = {}): Promise<void> {
    const po = new PO()
    po.headers = headers
    for (const item of Object.values(catalog)) {
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

type Compiled = {
    hasPlurals: boolean
    items: CompiledElement[]
}

type CompiledCatalogs = Record<string, Compiled>

type SharedState = {
    poFilesByLoc: Record<string, POFile>
    compiled: CompiledCatalogs
    indexTracker: IndexTracker
}

/* shared states among multiple adapters handlers */
export type SharedStates = Record<string, SharedState>

type GranularState = {
    id: string
    compiled: CompiledCatalogs
    indexTracker: IndexTracker
}

type LoaderPathEmpty = {[K in keyof LoaderPath]: boolean}

type TransformOutputCode = { code?: string, map?: any }

export class AdapterHandler {

    key: string

    // paths
    loaderPath: LoaderPath
    proxyPath: string
    outDir: string
    compiledHead: Record<string, string> = {}

    #virtualPrefix: string
    #config: ConfigPartial
    #locales: string[]
    fileMatches: Matcher
    #projectRoot: string

    #adapter: Adapter

    /* Shared state with other adapter handlers */
    sharedState: SharedState

    granularStateByFile: Record<string, GranularState> = {}
    granularStateByID: Record<string, GranularState> = {}

    #catalogsFname: Record<string, string> = {}
    catalogPathsToLocales: Record<string, string> = {}

    #mode: Mode
    #geminiQueue: Record<string, GeminiQueue> = {}

    #log: Logger

    constructor(adapter: Adapter, key: string, config: ConfigPartial, mode: Mode, virtualPrefix: string, projectRoot: string, log: Logger) {
        this.#adapter = adapter
        this.key = key.toString()
        this.#mode = mode
        this.#virtualPrefix = virtualPrefix
        this.#projectRoot = projectRoot
        this.#config = config
        this.#log = log
    }

    getLoaderPaths(): LoaderPath[] {
        if (this.#adapter.loaderPath != null) {
            if (typeof this.#adapter.loaderPath === 'string') {
                return [{
                    client: this.#adapter.loaderPath,
                    ssr: this.#adapter.loaderPath,
                }]
            }
            return [this.#adapter.loaderPath]
        }
        const catalogToLoader = this.#adapter.catalog.replace('{locale}', 'loader')
        const paths: LoaderPath[] = []
        for (const ext of this.#adapter.loaderExts) {
            let path = catalogToLoader
            if (path.startsWith('./')) {
                path = path.slice(2)
            }
            const pathClient = path + ext
            paths.push(
                { client: pathClient, ssr: path + '.ssr' + ext},
                { client: pathClient, ssr: pathClient },
            )
        }
        return paths
    }

    async getLoaderPath(): Promise<{ path: LoaderPath | null, empty: LoaderPathEmpty }> {
        const empty: LoaderPathEmpty = {client: true, ssr: true}
        for (const path of this.getLoaderPaths()) {
            let bothExist = true
            for (const side in empty) {
                try {
                    const contents = await readFile(path[side])
                    empty[side] = contents.toString().trim() === ''
                } catch (err: any) {
                    if (err.code !== 'ENOENT') {
                        throw err
                    }
                    bothExist = false
                    break
                }
            }
            if (!bothExist) {
                continue
            }
            return {path, empty}
        }
        return { path: null, empty }
    }

    async #initPaths() {
        const { path: loaderPath, empty } = await this.getLoaderPath()
        if (!loaderPath || Object.values(empty).some(side => side)) {
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
    virtModEvent = (locale: string, loadID: string | null) => `${this.#virtualPrefix}catalog/${this.key}/${loadID ?? this.key}/${locale}`

    #getCompiledFilePath(loc: string, id: string | null) {
        return this.compiledHead[loc] + (id ?? this.key) + this.#adapter.loaderExts[0]
    }

    #getCompiledImport(loc: string, id: string | null, forWriteFile: boolean) {
        if (forWriteFile) {
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

    getLoadIDs(): string[] {
        const loadIDs: string[] = []
        if (this.#adapter.granularLoad) {
            for (const loadID in this.granularStateByID) {
                loadIDs.push(loadID)
            }
        } else {
            loadIDs.push(this.key)
        }
        return loadIDs
    }

    getProxy(forWriteFile = false) {
        const imports = []
        const loadIDs = this.getLoadIDs()
        for (const id of loadIDs) {
            const importsByLocale = []
            for (const loc of this.#locales) {
                importsByLocale.push(`${objKeyLocale(loc)}: () => import('${this.#getCompiledImport(loc, id, forWriteFile)}')`)
            }
            imports.push(`${id}: {${importsByLocale.join(',')}}`)
        }
        return `
            const catalogs = {${imports.join(',')}}
            export const loadCatalog = (loadID, locale) => catalogs[loadID][locale]()
            ${this.#loaderLoadIDsNKey(loadIDs)}
        `
    }

    getProxySync(forWriteFile = false) {
        const loadIDs = this.getLoadIDs()
        const imports = []
        const object = []
        for (const id of loadIDs) {
            const importedByLocale = []
            for (const [i, loc] of this.#locales.entries()) {
                const locKey = `_w_c_${id}_${i}_`
                imports.push(`import * as ${locKey} from '${this.#getCompiledImport(loc, id, forWriteFile)}'`)
                importedByLocale.push(`${objKeyLocale(loc)}: ${locKey}`)
            }
            object.push(`${id}: {${importedByLocale.join(',')}}`)
        }
        // because locales are not available from virtual modules with writeFile
        const locales = forWriteFile ? `export const locales = ['${this.#locales.join(',')}']` : ''
        return `
            ${imports.join('\n')}
            const catalogs = {${object.join(',')}}
            export const loadCatalog = (loadID, locale) => catalogs[loadID][locale]
            ${this.#loaderLoadIDsNKey(loadIDs)}
            ${locales}
        `
    }

    catalogFileName = (locale: string): string => {
        let catalog = this.#adapter.catalog.replace('{locale}', locale)
        if (!isAbsolute(catalog)) {
            catalog = normalize(`${this.#projectRoot}/${catalog}`)
        }
        return `${catalog}.po`
    }

    init = async (sharedStates: SharedStates) => {
        this.#locales = [this.#config.sourceLocale, ...this.#config.otherLocales]
        await this.#initPaths()
        this.fileMatches = pm(...this.globConfToArgs(this.#adapter.files))
        const sourceLocaleName = getLanguageName(this.#config.sourceLocale)
        this.sharedState = sharedStates[this.#adapter.catalog]
        if (this.sharedState == null) {
            this.sharedState = {
                poFilesByLoc: {},
                indexTracker: new IndexTracker(),
                compiled: {},
            }
            sharedStates[this.#adapter.catalog] = this.sharedState
        }
        this.catalogPathsToLocales = {}
        for (const loc of this.#locales) {
            this.sharedState.poFilesByLoc[loc] = {
                catalog: {},
                pluralRule: defaultPluralRule,
                headers: {},
                loaded: false,
            }
            this.#catalogsFname[loc] = this.catalogFileName(loc)
            // for handleHotUpdate
            this.catalogPathsToLocales[this.#catalogsFname[loc]] = loc
            if (loc !== this.#config.sourceLocale) {
                this.#geminiQueue[loc] = new GeminiQueue(
                    sourceLocaleName,
                    getLanguageName(loc),
                    this.#config.geminiAPIKey,
                    async () => await this.savePoAndCompile(loc),
                    this.#log,
                )
            }
            await this.loadCatalogNCompile(loc)
        }
        await this.writeProxy()
    }

    loadCatalogNCompile = async (loc: string): Promise<void> => {
        try {
            this.sharedState.poFilesByLoc[loc] = await loadCatalogFromPO(this.#catalogsFname[loc])
            this.compile(loc)
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err
            }
            this.#log.log(`${color.magenta(this.key)}: Catalog not found for ${color.cyan(loc)}`)
        }
    }

    loadCatalogModule = (locale: string, loadID: string, hmrVersion = -1) => {
        let compiledData = this.sharedState.compiled[locale]
        if (this.#adapter.granularLoad) {
            compiledData = this.granularStateByID[loadID]?.compiled?.[locale] ?? { hasPlurals: false, items: [] }
        }
        const compiledItems = JSON.stringify(compiledData.items)
        const plural = `n => ${this.sharedState.poFilesByLoc[locale].pluralRule.plural}`
        let module = `export let ${catalogVarName} = ${compiledItems}`
        if (compiledData.hasPlurals) {
            module = `${module}\nexport let p = ${plural}`
        }
        if (this.#mode !== 'dev') {
            return module
        }
        return `
            ${module}
            let latestVersion = ${hmrVersion}
            export function update({ version, data }) {
                if (latestVersion >= version) {
                    return
                }
                for (const [ index, item ] of data['${locale}'] ?? []) {
                    ${catalogVarName}[index] = item
                }
                latestVersion = version
            }
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
        this.sharedState.compiled[loc] = { hasPlurals: false, items: [] }
        const catalog = this.sharedState.poFilesByLoc[loc].catalog
        for (const key in catalog) {
            const poItem = catalog[key]
            const index = this.sharedState.indexTracker.get(key)
            let compiled: CompiledElement
            const fallback = this.sharedState.compiled[this.#config.sourceLocale]?.items?.[index] // ?. for sourceLocale itself
            if (poItem.msgid_plural) {
                this.sharedState.compiled[loc].hasPlurals = true
                if (poItem.msgstr.join('').trim()) {
                    compiled = poItem.msgstr
                } else {
                    compiled = fallback
                }
            } else {
                compiled = compileTranslation(poItem.msgstr[0], fallback)
            }
            this.sharedState.compiled[loc].items[index] = compiled
            if (!this.#adapter.granularLoad) {
                continue
            }
            for (const fname of poItem.references) {
                const state = this.#getGranularState(fname)
                state.compiled[loc].hasPlurals = this.sharedState.compiled[loc].hasPlurals
                state.compiled[loc].items[state.indexTracker.get(key)] = compiled
            }
        }
        await this.writeCompiled(loc)
    }

    writeCompiled = async (loc: string) => {
        if (!this.#adapter.writeFiles.compiled) {
            return
        }
        await writeFile(this.#getCompiledFilePath(loc, null), this.loadCatalogModule(loc, null))
        if (!this.#adapter.granularLoad) {
            return
        }
        for (const state of Object.values(this.granularStateByID)) {
            await writeFile(this.#getCompiledFilePath(loc, state.id), this.loadCatalogModule(loc, state.id))
        }
    }

    writeProxy = async () => {
        if (!this.#adapter.writeFiles.proxy) {
            return
        }
        await writeFile(this.proxyPath, this.getProxySync(this.proxyPath != null))
    }

    writeTransformed = async (filename: string, content: string) => {
        if (!this.#adapter.writeFiles.transformed) {
            return
        }
        const fname = resolve(this.outDir + '/' + filename)
        await mkdir(dirname(fname), { recursive: true })
        await writeFile(fname, content)
    }

    globConfToArgs = (conf: GlobConf): [string[], { ignore: string[] }] => {
        let patterns: string[] = []
        // ignore generated files
        const options = { ignore: [this.loaderPath.client, this.loaderPath.ssr] }
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
        const poFile = this.sharedState.poFilesByLoc[loc]
        const fullHead = { ...poFile.headers ?? {} }
        const updateHeaders = [
            ['Plural-Forms', [
                `nplurals=${poFile.pluralRule.nplurals}`,
                `plural=${poFile.pluralRule.plural};`,
            ].join('; ')],
            ['Language', loc],
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
        await saveCatalogToPO(poFile.catalog, this.#catalogsFname[loc], fullHead)
        if (this.#mode !== 'extract') { // save for the end
            await this.compile(loc)
        }
    }

    #putImportSpec = (varName: string | null, alias: string, importsFuncs: string[]) => {
        if (!varName) {
            return
        }
        if (varName === 'default') {
            importsFuncs.unshift(alias) // default imports are first
        } else {
            importsFuncs.push(`{${varName} as ${alias}}`)
        }
    }

    #hmrUpdateFunc = (getFuncName: string, getFuncNameHmr: string) => {
        const catalogVar = '_w_catalog_'
        return `
            function ${getFuncName}(loadID) {
                const ${catalogVar} = ${getFuncNameHmr}(loadID)
                ${catalogVar}?.update?.(${varNames.hmrUpdate})
                return ${catalogVar}
            }
        `
    }

    #prepareHeader = (filename: string, loadID: string, hmrData: HMRData, ssr: boolean): string => {
        let loaderRelTo = filename
        if (this.#adapter.writeFiles.transformed) {
            loaderRelTo = resolve(this.outDir + '/' + filename)
        }
        let loaderPath = relative(dirname(loaderRelTo), ssr ? this.loaderPath.ssr : this.loaderPath.client)
        if (platform === 'win32') {
            loaderPath = loaderPath.replaceAll('\\', '/')
        }
        if (!loaderPath.startsWith('.')) {
            loaderPath = `./${loaderPath}`
        }
        const importsFuncs = []
        const runtimeConf = this.#adapter.runtime
        let head = []
        let getFuncImportPlain = getFuncPlain
        let getFuncImportReactive = getFuncReactive
        if (hmrData != null) {
            head.push(`const ${varNames.hmrUpdate} = ${JSON.stringify(hmrData)}`)
            getFuncImportPlain += 'hmr_'
            getFuncImportReactive += 'hmr_'
            if (runtimeConf.plain?.importName) {
                head.push(this.#hmrUpdateFunc(getFuncPlain, getFuncImportPlain))
            }
            if (runtimeConf.reactive?.importName) {
                head.push(this.#hmrUpdateFunc(getFuncReactive, getFuncImportReactive))
            }
        }
        this.#putImportSpec(runtimeConf.plain?.importName, getFuncImportPlain, importsFuncs)
        this.#putImportSpec(runtimeConf.reactive?.importName, getFuncImportReactive, importsFuncs)
        head = [
            `import ${varNames.rtWrap} from 'wuchale/runtime'`,
            `import ${importsFuncs.join(',')} from "${loaderPath}"`,
            ...head,
        ]
        if (!this.#adapter.bundleLoad) {
            return head.join('\n')
        }
        const imports = []
        const objElms = []
        for (const [i, loc] of this.#locales.entries()) {
            const locKW = `_w_c_${i}_`
            imports.push(`import * as ${locKW} from '${this.virtModEvent(loc, loadID)}'`)
            objElms.push(`${objKeyLocale(loc)}: ${locKW}`)
        }
        return [
            ...imports,
            ...head,
            `const ${catalogsVarName} = {${objElms.join(',')}}`
        ].join('\n')
    }

    #prepareRuntimeExpr = (loadID: string): CatalogExpr => {
        if (this.#adapter.bundleLoad) {
            return bundledCatalogExpr
        }
        return {
            plain: `${getFuncPlain}('${loadID}')`,
            reactive: `${getFuncReactive}('${loadID}')`,
        }
    }

    transform = async (content: string, filename: string, hmrVersion = -1, ssr = false): Promise<TransformOutputCode> => {
        if (platform === 'win32') {
            filename = filename.replaceAll('\\', '/')
        }
        let indexTracker = this.sharedState.indexTracker
        let loadID = this.key
        let compiled = this.sharedState.compiled
        if (this.#adapter.granularLoad) {
            const state = this.#getGranularState(filename)
            indexTracker = state.indexTracker
            loadID = state.id
            compiled = state.compiled
        }
        const { msgs, ...result } = this.#adapter.transform({
            content,
            filename,
            index: indexTracker,
            expr: this.#prepareRuntimeExpr(loadID),
        })
        const hmrKeys: Record<string, string[]> = {}
        for (const loc of this.#locales) {
            // clear references to this file first
            let previousReferences: Record<string, number> = {}
            let fewerRefs = false
            const poFile = this.sharedState.poFilesByLoc[loc]
            for (const item of Object.values(poFile.catalog)) {
                if (!item.references.includes(filename)) {
                    continue
                }
                const key = new Message([item.msgid, item.msgid_plural], null, item.msgctxt).toKey()
                const prevRefs = item.references.length
                item.references = item.references.filter(f => f !== filename)
                previousReferences[key] = prevRefs - item.references.length
                item.obsolete = item.references.length === 0
                fewerRefs = true
            }
            if (!msgs.length) {
                if (fewerRefs) {
                    this.savePoAndCompile(loc)
                }
                continue
            }
            let newItems: boolean = false
            hmrKeys[loc] = []
            const untranslated: ItemType[] = []
            let newRefs = false
            for (const msgInfo of msgs) {
                let key = msgInfo.toKey()
                hmrKeys[loc].push(key)
                let poItem = poFile.catalog[key]
                if (!poItem) {
                    // @ts-expect-error
                    poItem = new PO.Item({
                        nplurals: poFile.pluralRule.nplurals,
                    })
                    poItem.msgid = msgInfo.msgStr[0]
                    if (msgInfo.plural) {
                        poItem.msgid_plural = msgInfo.msgStr[1] ?? msgInfo.msgStr[0]
                    }
                    poFile.catalog[key] = poItem
                    newItems = true
                }
                poItem.extractedComments = msgInfo.comments
                if (msgInfo.context) {
                    poItem.msgctxt = msgInfo.context
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
                    const msgStr = msgInfo.msgStr.join('\n')
                    if (poItem.msgstr.join('\n') !== msgStr) {
                        poItem.msgstr = msgInfo.msgStr
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
            if (loc === this.#config.sourceLocale || !this.#geminiQueue[loc]?.url) {
                if (newItems || newRefs) {
                    await this.savePoAndCompile(loc)
                }
                continue
            }
            this.#geminiQueue[loc].add(untranslated)
            await this.#geminiQueue[loc].running
        }
        let output: TransformOutputCode = {}
        if (msgs.length) {
            let hmrData: HMRData = null
            if (hmrVersion >= 0) {
                hmrData = { version: hmrVersion, data: {} }
                for (const loc of this.#locales) {
                    hmrData.data[loc] = hmrKeys[loc]?.map(key => {
                        const index = indexTracker.get(key)
                        return [ index, compiled[loc].items[index] ]
                    })
                }
            }
            output = result.output(this.#prepareHeader(filename, loadID, hmrData, ssr))
        }
        await this.writeTransformed(filename, output.code ?? content)
        return output
    }
}
