// $$ cd ../.. && npm run test
import { basename, dirname, isAbsolute, resolve, normalize, relative, join } from 'node:path'
import { platform } from 'node:process'
import { IndexTracker, Message } from "./adapters.js"
import type { Adapter, CatalogExpr, GlobConf, HMRData, LoaderPath } from "./adapters.js"
import { mkdir, readFile, statfs, writeFile } from 'node:fs/promises'
import { compileTranslation, type CompiledElement } from "./compile.js"
import AIQueue, { type ItemType } from "./ai/index.js"
import pm, { type Matcher } from 'picomatch'
import PO from "pofile"
import { type ConfigPartial, getLanguageName } from "./config.js"
import { color, type Logger } from './log.js'
import { catalogVarName } from './runtime.js'
import { varNames } from './adapter-utils/index.js'
import { match as matchUrlPattern, compile as compileUrlPattern } from 'path-to-regexp'
import type { URLManifest } from './url.js'

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
}

const generatedDir = '.wuchale'
const urlPatternFlag = 'url-pattern'
const urlExtractedFlag = 'url-extracted'

const loaderImportGetRuntime = 'getRuntime'
const loaderImportGetRuntimeRx = 'getRuntimeRx'

const getFuncPlain = '_w_load_'
const getFuncReactive = getFuncPlain + 'rx_'
const bundleCatalogsVarName = '_w_catalogs_'
const bundledCatalogExpr: CatalogExpr = {
    plain: `${getFuncPlain}(${bundleCatalogsVarName})`,
    reactive: `${getFuncReactive}(${bundleCatalogsVarName})`,
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
    return { catalog, pluralRule, headers: po.headers }
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
    ownerKey: string
    poFilesByLoc: Record<string, POFile>
    compiled: CompiledCatalogs
    extractedUrls: Record<string, Catalog>
    indexTracker: IndexTracker
}

/* shared states among multiple adapters handlers */
export type SharedStates = Record<string, SharedState>

type GranularState = {
    id: string
    compiled: CompiledCatalogs
    indexTracker: IndexTracker
}

type TransformOutputCode = { code?: string, map?: any }

export class AdapterHandler {

    key: string

    // paths
    loaderPath: LoaderPath
    proxyPath: string
    proxySyncPath: string

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
    #urlManifestFname: string
    #urlsFname: string
    #generatedDir: string
    catalogPathsToLocales: Record<string, string> = {}

    #mode: Mode
    #geminiQueue: Record<string, AIQueue> = {}

    #log: Logger

    onBeforeWritePO: () => void

    constructor(adapter: Adapter, key: string, config: ConfigPartial, mode: Mode, projectRoot: string, log: Logger) {
        this.#adapter = adapter
        this.key = key
        this.#mode = mode
        this.#projectRoot = projectRoot
        this.#config = config
        this.#log = log
        this.#generatedDir = `${adapter.localesDir}/${generatedDir}`
    }

    getLoaderPaths(): LoaderPath[] {
        const loaderPathHead = join(this.#adapter.localesDir, `${this.key}.loader`)
        const paths: LoaderPath[] = []
        for (const ext of this.#adapter.loaderExts) {
            const pathClient = loaderPathHead + ext
            const same = { client: pathClient, server: pathClient }
            const diff = { client: pathClient, server: loaderPathHead + '.server' + ext}
            if (this.#adapter.defaultLoaderPath == null) {
                paths.push(diff, same)
            } else if (typeof this.#adapter.defaultLoaderPath === 'string') { // same file for both
                paths.push(same)
            } else {
                paths.push(diff)
            }
        }
        return paths
    }

    async getLoaderPath(): Promise<LoaderPath> {
        const paths = this.getLoaderPaths()
        for (const path of paths) {
            let bothExist = true
            for (const side in path) {
                try {
                    await statfs(path[side])
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
            return path
        }
        return paths[0]
    }

    #proxyFileName(sync = false) {
        let namePart = `${this.key}.proxy`
        if (sync) {
            return `${namePart}.sync.js`
        }
        return `${namePart}.js`
    }

    async #initPaths() {
        this.loaderPath = await this.getLoaderPath()
        this.proxyPath = join(this.#generatedDir, this.#proxyFileName())
        this.proxySyncPath = join(this.#generatedDir, this.#proxyFileName(true))
        this.#urlManifestFname = join(this.#generatedDir, `${this.key}.urls.js`)
        this.#urlsFname = join(this.#adapter.localesDir, `${this.key}.url.js`)
    }

    getCompiledFilePath(loc: string, id: string | null) {
        const ownerKey = this.sharedState.ownerKey
        return join(this.#generatedDir, `${ownerKey}.${id ?? ownerKey}.${loc}.compiled.js`)
    }

    #getCompiledImport(loc: string, id: string | null) {
        return './' + basename(this.getCompiledFilePath(loc, id))
    }

    getLoadIDs(forImport = false): string[] {
        const loadIDs: string[] = []
        if (this.#adapter.granularLoad) {
            for (const loadID in this.granularStateByID) {
                loadIDs.push(loadID)
            }
        } else if (forImport) {
            loadIDs.push(this.sharedState.ownerKey)
        } else {
            loadIDs.push(this.key)
        }
        return loadIDs
    }

    getProxy() {
        const imports = []
        const loadIDs = this.getLoadIDs()
        const loadIDsImport = this.getLoadIDs(true)
        for (const [i, id] of loadIDs.entries()) {
            const importsByLocale = []
            for (const loc of this.#locales) {
                importsByLocale.push(`${objKeyLocale(loc)}: () => import('${this.#getCompiledImport(loc, loadIDsImport[i])}')`)
            }
            imports.push(`${id}: {${importsByLocale.join(',')}}`)
        }
        return `
            const catalogs = {${imports.join(',')}}
            export const loadCatalog = (loadID, locale) => catalogs[loadID][locale]()
            export const loadIDs = ['${loadIDs.join("', '")}']
        `
    }

    getProxySync() {
        const loadIDs = this.getLoadIDs()
        const loadIDsImport = this.getLoadIDs(true)
        const imports = []
        const object = []
        for (const [il, id] of loadIDs.entries()) {
            const importedByLocale = []
            for (const [i, loc] of this.#locales.entries()) {
                const locKey = `_w_c_${id}_${i}_`
                imports.push(`import * as ${locKey} from '${this.#getCompiledImport(loc, loadIDsImport[il])}'`)
                importedByLocale.push(`${objKeyLocale(loc)}: ${locKey}`)
            }
            object.push(`${id}: {${importedByLocale.join(',')}}`)
        }
        return `
            ${imports.join('\n')}
            const catalogs = {${object.join(',')}}
            export const loadCatalog = (loadID, locale) => catalogs[loadID][locale]
            export const loadIDs = ['${loadIDs.join("', '")}']
        `
    }

    getData() {
        return [
            `export const sourceLocale = '${this.#config.sourceLocale}'`,
            `export const otherLocales = ['${this.#config.otherLocales.join("','")}']`,
            `export const locales = ['${this.#locales.join("','")}']`,
        ].join('\n')
    }

    catalogFileName = (locale: string): string => {
        let catalog = join(this.#adapter.localesDir, `${locale}.po`)
        if (!isAbsolute(catalog)) {
            catalog = normalize(`${this.#projectRoot}/${catalog}`)
        }
        return catalog
    }

    #initFiles = async () => {
        if (this.#adapter.defaultLoaderPath == null) {
            // using custom loaders
            return
        }
        await mkdir(this.#generatedDir, {recursive: true})
        const dataFile = 'data.js'
        for (const side in this.loaderPath) {
            let loaderTemplate: string
            if (typeof this.#adapter.defaultLoaderPath === 'string') {
                loaderTemplate = this.#adapter.defaultLoaderPath
            } else {
                loaderTemplate = this.#adapter.defaultLoaderPath[side]
            }
            const loaderContent = (await readFile(loaderTemplate)).toString()
                .replace('${PROXY}', `./${generatedDir}/${this.#proxyFileName()}`)
                .replace('${PROXY_SYNC}', `./${generatedDir}/${this.#proxyFileName(true)}`)
                .replace('${DATA}', `./${dataFile}`)
                .replace('${KEY}', this.key)
            await writeFile(this.loaderPath[side], loaderContent)
        }
        await writeFile(join(this.#adapter.localesDir, dataFile), this.getData())
    }

    writeUrls = async () => {
        const patterns = this.#adapter.url?.patterns
        if (!patterns) {
            return
        }
        const manifest: URLManifest = patterns.map(patt => [
            patt,
            this.#locales.map(loc => {
                const item = this.sharedState.poFilesByLoc[loc].catalog[patt]
                const pattern = item.msgstr[0] || item.msgid
                return [loc, this.#adapter.url.localize?.(pattern, loc) ?? pattern]
            })
        ])
        const urlManifestData = [
            `/** @type {import('wuchale/url').URLManifest} */`,
            `export default ${JSON.stringify(manifest)}`,
        ].join('\n')
        await writeFile(this.#urlManifestFname, urlManifestData)
        const urlFileContent = [
            'import {URLMatcher} from "wuchale/url"',
            `import manifest from "./${relative(dirname(this.#urlsFname), this.#urlManifestFname)}"`,
            'import {locales} from "./data.js"',
            `export default URLMatcher(manifest, locales)`
        ].join('\n')
        await writeFile(this.#urlsFname, urlFileContent)
    }

    init = async (sharedStates: SharedStates) => {
        this.#locales = [this.#config.sourceLocale, ...this.#config.otherLocales]
        await this.#initPaths()
        await this.#initFiles()
        this.fileMatches = pm(...this.globConfToArgs(this.#adapter.files))
        const sourceLocaleName = getLanguageName(this.#config.sourceLocale)
        this.sharedState = sharedStates[this.#adapter.localesDir]
        if (this.sharedState == null) {
            this.sharedState = {
                ownerKey: this.key,
                poFilesByLoc: {},
                indexTracker: new IndexTracker(),
                compiled: {},
                extractedUrls: {},
            }
            sharedStates[this.#adapter.localesDir] = this.sharedState
        }
        this.catalogPathsToLocales = {}
        for (const loc of this.#locales) {
            this.#catalogsFname[loc] = this.catalogFileName(loc)
            // for handleHotUpdate
            this.catalogPathsToLocales[this.#catalogsFname[loc]] = loc
            if (loc !== this.#config.sourceLocale) {
                this.#geminiQueue[loc] = new AIQueue(
                    sourceLocaleName,
                    getLanguageName(loc),
                    this.#config.ai,
                    async () => await this.savePoAndCompile(loc),
                    this.#log,
                )
            }
            if (this.sharedState.ownerKey === this.key) {
                this.sharedState.poFilesByLoc[loc] = {
                    catalog: {},
                    pluralRule: defaultPluralRule,
                    headers: {},
                }
                this.sharedState.extractedUrls[loc] = {}
            }
            await this.loadCatalogNCompile(loc)
        }
        await this.writeProxies()
        await this.writeUrls()
    }

    loadCatalogNCompile = async (loc: string): Promise<void> => {
        try {
            if (this.sharedState.ownerKey === this.key) {
                this.sharedState.poFilesByLoc[loc] = await loadCatalogFromPO(this.#catalogsFname[loc])
            }
            const catalog = this.sharedState.poFilesByLoc[loc].catalog
            const urlPatterns = this.#adapter.url?.patterns ?? []
            for (const [key, item] of Object.entries(catalog)) {
                if (!item.flags[urlPatternFlag]) {
                    continue
                }
                if (urlPatterns.includes(item.msgid)) {
                    if (!item.references.includes(this.key)) {
                        item.references.push(this.key)
                    }
                } else {
                    item.references = item.references.filter(r => r !== this.key)
                    if (item.references.length === 0) {
                        delete catalog[key]
                    }
                }
            }
            for (const pattern of urlPatterns) {
                if (pattern in catalog) {
                    continue
                }
                const item = new PO.Item()
                item.msgid = pattern
                item.flags[urlPatternFlag] = true
                item.references = [this.key]
                catalog[pattern] = item
            }
            this.compile(loc)
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err
            }
            this.#log.warn(`${color.magenta(this.key)}: Catalog not found for ${color.cyan(loc)}`)
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
            // only during dev, for HMR
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

    async #getGranularState(filename: string): Promise<GranularState> {
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
                await this.writeProxies()
            }
            this.granularStateByFile[filename] = this.granularStateByID[id]
        }
        return state
    }

    matchUrl = (url: string) => {
        for (const pattern of this.#adapter.url?.patterns ?? []) {
            if (matchUrlPattern(pattern, {decode: false})(url)) {
                return pattern
            }
        }
        return null
    }

    getUrlToCompile = (key: string, locale: string) => {
        const catalog = this.sharedState.poFilesByLoc[locale].catalog
        let toCompile = key
        const relevantPattern = this.matchUrl(key)
        if (relevantPattern == null) {
            return toCompile
        }
        const patternItem = catalog[relevantPattern]
        const matchedUrl = matchUrlPattern(patternItem.msgid, {decode: false})(key)
        if (matchedUrl) {
            const compileTranslated = compileUrlPattern(patternItem.msgstr[0] || key, {encode: false})
            toCompile = compileTranslated(matchedUrl.params)
        }
        if (this.#adapter.url?.localize) {
            toCompile = this.#adapter.url.localize(toCompile || key, locale)
        }
        return toCompile
    }

    compile = async (loc: string) => {
        this.sharedState.compiled[loc] ??= { hasPlurals: false, items: [] }
        const catalog = this.sharedState.poFilesByLoc[loc].catalog
        for (const [key, poItem] of Object.entries({...catalog, ...this.sharedState.extractedUrls[loc]})) {
            if (poItem.flags[urlPatternFlag]) { // useless in compiled catalog
                continue
            }
            // compile only if it came from a file under this adapter
            if (!poItem.references.some(f => this.fileMatches(f))) {
                continue
            }
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
                let toCompile = poItem.msgstr[0]
                if (poItem.flags[urlExtractedFlag]) {
                    toCompile = this.getUrlToCompile(key, loc)
                }
                compiled = compileTranslation(toCompile, fallback)
            }
            this.sharedState.compiled[loc].items[index] = compiled
            if (!this.#adapter.granularLoad) {
                continue
            }
            for (const fname of poItem.references) {
                const state = await this.#getGranularState(fname)
                state.compiled[loc].hasPlurals = this.sharedState.compiled[loc].hasPlurals
                state.compiled[loc].items[state.indexTracker.get(key)] = compiled
            }
        }
        await this.writeCompiled(loc)
    }

    writeCompiled = async (loc: string) => {
        await writeFile(this.getCompiledFilePath(loc, null), this.loadCatalogModule(loc, null))
        if (!this.#adapter.granularLoad) {
            return
        }
        for (const state of Object.values(this.granularStateByID)) {
            await writeFile(this.getCompiledFilePath(loc, state.id), this.loadCatalogModule(loc, state.id))
        }
    }

    writeProxies = async () => {
        await writeFile(this.proxyPath, this.getProxy())
        await writeFile(this.proxySyncPath, this.getProxySync())
    }

    writeTransformed = async (filename: string, content: string) => {
        if (!this.#adapter.outDir) {
            return
        }
        const fname = resolve(this.#adapter.outDir + '/' + filename)
        await mkdir(dirname(fname), { recursive: true })
        await writeFile(fname, content)
    }

    globConfToArgs = (conf: GlobConf): [string[], { ignore: string[] }] => {
        let patterns: string[] = []
        // ignore generated files
        const options = {
            ignore: [
                this.loaderPath.client,
                this.loaderPath.server,
                this.#adapter.localesDir,
            ]
        }
        if (this.#adapter.outDir) {
            options.ignore.push(this.#adapter.outDir)
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

    savePO = async (loc: string) => {
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
    }

    savePoAndCompile = async (loc: string) => {
        this.onBeforeWritePO?.()
        if (this.#mode === 'extract') { // save for the end
            return
        }
        await this.savePO(loc)
        await this.compile(loc)
    }

    #hmrUpdateFunc = (getFuncName: string, getFuncNameHmr: string) => {
        const rtVar = '_w_rt_'
        return `
            function ${getFuncName}(loadID) {
                const ${rtVar} = ${getFuncNameHmr}(loadID)
                ${rtVar}?._?.update?.(${varNames.hmrUpdate})
                return ${rtVar}
            }
        `
    }

    #prepareHeader = (filename: string, loadID: string, hmrData: HMRData, forServer: boolean): string => {
        let loaderRelTo = filename
        if (this.#adapter.outDir) {
            loaderRelTo = resolve(this.#adapter.outDir + '/' + filename)
        }
        let loaderPath = relative(dirname(loaderRelTo), forServer ? this.loaderPath.server : this.loaderPath.client)
        if (platform === 'win32') {
            loaderPath = loaderPath.replaceAll('\\', '/')
        }
        if (!loaderPath.startsWith('.')) {
            loaderPath = `./${loaderPath}`
        }
        let head = []
        let getFuncImportPlain = getFuncPlain
        let getFuncImportReactive = getFuncReactive
        if (hmrData != null) {
            head.push(`const ${varNames.hmrUpdate} = ${JSON.stringify(hmrData)}`)
            getFuncImportPlain += 'hmr_'
            getFuncImportReactive += 'hmr_'
            head.push(
                this.#hmrUpdateFunc(getFuncPlain, getFuncImportPlain),
                this.#hmrUpdateFunc(getFuncReactive, getFuncImportReactive),
            )
        }
        const importsFuncs = [
            `${loaderImportGetRuntime} as ${getFuncImportPlain}`,
            `${loaderImportGetRuntimeRx} as ${getFuncImportReactive}`,
        ]
        head = [
            `import {${importsFuncs.join(', ')}} from "${loaderPath}"`,
            ...head,
        ]
        if (!this.#adapter.bundleLoad) {
            return head.join('\n')
        }
        const imports = []
        const objElms = []
        for (const [i, loc] of this.#locales.entries()) {
            const locKW = `_w_c_${i}_`
            const importFrom = relative(dirname(loaderRelTo), this.#getCompiledImport(loc, loadID))
            imports.push(`import * as ${locKW} from '${importFrom}'`)
            objElms.push(`${objKeyLocale(loc)}: ${locKW}`)
        }
        return [
            ...imports,
            ...head,
            `const ${bundleCatalogsVarName} = {${objElms.join(',')}}`
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

    transform = async (content: string, filename: string, hmrVersion = -1, forServer = false): Promise<TransformOutputCode> => {
        if (platform === 'win32') {
            filename = filename.replaceAll('\\', '/')
        }
        let indexTracker = this.sharedState.indexTracker
        let loadID = this.key
        let compiled = this.sharedState.compiled
        if (this.#adapter.granularLoad) {
            const state = await this.#getGranularState(filename)
            indexTracker = state.indexTracker
            loadID = state.id
            compiled = state.compiled
        }
        const { msgs, ...result } = this.#adapter.transform({
            content,
            filename,
            index: indexTracker,
            expr: this.#prepareRuntimeExpr(loadID),
            matchUrl: this.matchUrl,
        })
        if (this.#log.checkLevel('verbose')) {
            if (msgs.length) {
                this.#log.verbose(`${this.key}: ${msgs.length} messages from ${filename}:`)
                for (const msg of msgs) {
                    this.#log.verbose(`  ${msg.msgStr.join(', ')} [${msg.details.scope}]`)
                }
            } else {
                this.#log.verbose(`${this.key}: No messages from ${filename}.`)
            }
        }
        const hmrKeys: Record<string, string[]> = {}
        for (const loc of this.#locales) {
            const poFile = this.sharedState.poFilesByLoc[loc]
            const extractedUrls = this.sharedState.extractedUrls[loc]
            const previousReferences: Record<string, {count: number, indices: number[]}> = {}
            for (const item of [...Object.values(poFile.catalog), ...Object.values(extractedUrls)]) {
                if (!item.references.includes(filename)) {
                    continue
                }
                const key = new Message([item.msgid, item.msgid_plural], null, item.msgctxt).toKey()
                previousReferences[key] = {count: 0, indices: []}
                for (const [i, ref] of item.references.entries()) {
                    if (ref !== filename) {
                        continue
                    }
                    previousReferences[key].count++
                    previousReferences[key].indices.push(i)
                }
            }
            let newItems: boolean = false
            hmrKeys[loc] = []
            const untranslated: ItemType[] = []
            let newRefs = false
            let commentsChanged = false
            for (const msgInfo of msgs) {
                const key = msgInfo.toKey()
                hmrKeys[loc].push(key)
                const collection = msgInfo.url ? extractedUrls : poFile.catalog
                let poItem = collection[key]
                if (!poItem) {
                    // @ts-expect-error
                    poItem = new PO.Item({
                        nplurals: poFile.pluralRule.nplurals,
                    })
                    poItem.msgid = msgInfo.msgStr[0]
                    if (msgInfo.plural) {
                        poItem.msgid_plural = msgInfo.msgStr[1] ?? msgInfo.msgStr[0]
                    }
                    collection[key] = poItem
                    newItems = true
                }
                if (msgInfo.context) {
                    poItem.msgctxt = msgInfo.context
                }
                const newComments = msgInfo.comments.map(c => c.replace(/\s+/g, ' ').trim())
                let iStartComm: number
                if (key in previousReferences) {
                    const prevRef = previousReferences[key]
                    iStartComm = prevRef.indices.pop() * newComments.length
                    const prevComments = poItem.extractedComments.slice(iStartComm, iStartComm + newComments.length)
                    if (prevComments.length !== newComments.length || prevComments.some((c, i) => c !== newComments[i])) {
                        commentsChanged = true
                    }
                    if (prevRef.indices.length === 0) {
                        delete previousReferences[key]
                    }
                } else {
                    iStartComm = poItem.references.length * newComments.length
                    poItem.references.push(filename)
                    poItem.references.sort() // make it deterministic
                    newRefs = true // now it references it
                }
                if (newComments.length) {
                    poItem.extractedComments.splice(iStartComm, newComments.length, ...newComments)
                }
                poItem.obsolete = false
                if (msgInfo.url) {
                    poItem.flags[urlExtractedFlag] = true // important in compile, but not written to po file
                    continue
                }
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
            const removedRefs = Object.entries(previousReferences)
            for (const [key, info] of removedRefs) {
                const item = poFile.catalog[key]
                const commentPerRef = Math.floor(item.extractedComments.length / item.references.length)
                for (const index of info.indices) {
                    item.references.splice(index, 1)
                    item.extractedComments.splice(index * commentPerRef, commentPerRef)
                }
                if (item.references.length === 0) {
                    item.obsolete = true
                }
            }
            if (untranslated.length === 0) {
                if (newRefs || removedRefs.length || commentsChanged) {
                    await this.savePoAndCompile(loc)
                }
                continue
            }
            if (loc === this.#config.sourceLocale || !this.#geminiQueue[loc]?.ai) {
                if (newItems || newRefs || commentsChanged) {
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
            output = result.output(this.#prepareHeader(filename, loadID, hmrData, forServer))
        }
        await this.writeTransformed(filename, output.code ?? content)
        return output
    }
}
