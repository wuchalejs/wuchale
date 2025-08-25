// $$ cd ../.. && npm run test
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { IndexTracker, Message } from "./adapters.js"
import type { Adapter, GlobConf, HMRData } from "./adapters.js"
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { compileTranslation, type CompiledElement } from "./compile.js"
import GeminiQueue, { type ItemType } from "./gemini.js"
import pm, { type Matcher } from 'picomatch'
import PO from "pofile"
import { normalize } from "node:path"
import { type ConfigPartial, getLanguageName } from "./config.js"
import { color, type Logger } from './log.js'
import { catalogVarName } from './runtime.js'
import { runtimeVars } from './adapter-utils/index.js'

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
    id: string,
    compiled: CompiledCatalogs,
    indexTracker: IndexTracker,
}

export class AdapterHandler {

    key: string

    // paths
    loaderPath: string
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

    constructor(adapter: Adapter, key: string | number, config: ConfigPartial, mode: Mode, virtualPrefix: string, projectRoot: string, log: Logger) {
        this.#adapter = adapter
        this.key = key.toString()
        this.#mode = mode
        this.#virtualPrefix = virtualPrefix
        this.#projectRoot = projectRoot
        this.#config = config
        this.#log = log
    }

    getLoaderPaths(): string[] {
        if (this.#adapter.loaderPath != null) {
            return [this.#adapter.loaderPath]
        }
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

    async getLoaderPath(): Promise<{ path: string | null, empty: boolean }> {
        for (const path of this.getLoaderPaths()) {
            try {
                const contents = await readFile(path)
                return { path, empty: contents.toString().trim() === '' }
            } catch (err: any) {
                if (err.code !== 'ENOENT') {
                    throw err
                }
                continue
            }
        }
        return { path: null, empty: true }
    }

    async #initPaths() {
        const { path: loaderPath, empty } = await this.getLoaderPath()
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
    virtModEvent = (locale: string, loadID: string | null) => `${this.#virtualPrefix}catalog/${this.key}/${loadID ?? this.key}/${locale}`

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

    getProxy(proxyFilePath?: string) {
        const imports = []
        const loadIDs = this.getLoadIDs()
        for (const id of loadIDs) {
            const importsByLocale = []
            for (const loc of this.#locales) {
                importsByLocale.push(`${objKeyLocale(loc)}: () => import('${this.#getCompiledImport(loc, id, proxyFilePath)}')`)
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
        const loadIDs = this.getLoadIDs()
        const imports = []
        const object = []
        for (const id of loadIDs) {
            const importedByLocale = []
            for (const [i, loc] of this.#locales.entries()) {
                const locKey = `_w_c_${id}_${i}_`
                imports.push(`import * as ${locKey} from '${this.#getCompiledImport(loc, id, proxyFilePath)}'`)
                importedByLocale.push(`${objKeyLocale(loc)}: ${locKey}`)
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
        await writeFile(this.proxyPath, this.getProxySync(this.proxyPath))
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

    #prepareHeader = (filename: string, loadID: string, hasHmr: boolean): { head: string, expr: string } => {
        let loaderRelTo = filename
        if (this.#adapter.writeFiles.transformed) {
            loaderRelTo = resolve(this.outDir + '/' + filename)
        }
        let loaderPath = relative(dirname(loaderRelTo), this.loaderPath)
        if (!loaderPath.startsWith('.')) {
            loaderPath = `./${loaderPath}`
        }
        const getFuncName = '_w_load_'
        let head = `import ${runtimeVars.rtWrap} from 'wuchale/runtime'\n`
        if (hasHmr) {
            const getFuncHmr = `_w_load_hmr_`
            const catalogVar = '_w_catalog_'
            head += `
                import ${getFuncHmr} from "${loaderPath}"
                function ${getFuncName}(loadID) {
                    const ${catalogVar} = ${getFuncHmr}(loadID)
                    ${catalogVar}?.update?.(${runtimeVars.hmrUpdate})
                    return ${catalogVar}
                }
            `
        } else {
            head += `import ${getFuncName} from "${loaderPath}"`
        }
        if (!this.#adapter.bundleLoad) {
            return {
                head,
                expr: `${getFuncName}('${loadID}')`,
            }
        }
        const imports = []
        const objElms = []
        for (const [i, loc] of this.#locales.entries()) {
            const locKW = `_w_c_${i}_`
            imports.push(`import * as ${locKW} from '${this.virtModEvent(loc, loadID)}'`)
            objElms.push(`${objKeyLocale(loc)}: ${locKW}`)
        }
        const catalogsVarName = '_w_catalogs_'
        return {
            head: [
                head,
                ...imports,
                `const ${catalogsVarName} = {${objElms.join(',')}}`
            ].join('\n'),
            expr: `${getFuncName}(${catalogsVarName})`,
        }
    }

    transform = async (content: string, filename: string, hmrVersion = -1): Promise<{ code?: string, map?: any }> => {
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
            header: this.#prepareHeader(filename, loadID, hmrVersion >= 0),
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
                msgInfo.trimLines()
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
            const newRequest = this.#geminiQueue[loc].add(untranslated)
            const opType = `(${newRequest ? color.yellow('new request') : color.green('add to request')})`
            this.#log.log(`Gemini translate ${color.cyan(untranslated.length)} items to ${color.cyan(getLanguageName(loc))} ${opType}`)
            await this.#geminiQueue[loc].running
        }
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
        const output = result.output(hmrData)
        await this.writeTransformed(filename, output.code ?? content)
        if (!msgs.length) {
            return {}
        }
        return output
    }
}
