import { dirname, isAbsolute, resolve, normalize, relative, join } from 'node:path'
import { platform } from 'node:process'
import { glob } from "tinyglobby"
import { IndexTracker, Message } from "./adapters.js"
import type { Adapter, CatalogExpr, GlobConf, HMRData, LoaderPath } from "./adapters.js"
import { mkdir, readFile, statfs, writeFile } from 'node:fs/promises'
import { compileTranslation, type CompiledElement, type Mixed } from "./compile.js"
import AIQueue, { type ItemType } from "./ai/index.js"
import pm, { type Matcher } from 'picomatch'
import PO from "pofile"
import { type ConfigPartial, getLanguageName } from "./config.js"
import { color, type Logger } from './log.js'
import { catalogVarName } from './runtime.js'
import { varNames } from './adapter-utils/index.js'
import { match as matchUrlPattern, compile as compileUrlPattern, pathToRegexp, type Token, stringify } from 'path-to-regexp'
import { localizeDefault, type URLLocalizer, type URLManifest } from './url.js'

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

const dataFileName = 'data.js'
const generatedDir = '.wuchale'
export const urlPatternFlag = 'url-pattern'
const urlExtractedFlag = 'url-extracted'

const loaderImportGetRuntime = 'getRuntime'
const loaderImportGetRuntimeRx = 'getRuntimeRx'

const getFuncPlainDefault = '_w_load_'
const getFuncReactiveDefault = getFuncPlainDefault + 'rx_'
const bundleCatalogsVarName = '_w_catalogs_'

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

function poDumpToString(items: ItemType[]) {
    const po = new PO()
    po.items = items
    return po.toString()
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

export type Mode = 'dev' | 'build' | 'cli'

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

/* shared states among multiple adapters handlers, by localesDir */
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
    localizeUrl?: URLLocalizer
    #projectRoot: string

    #adapter: Adapter

    /* Shared state with other adapter handlers */
    sharedState: SharedState

    granularStateByFile: Record<string, GranularState> = {}
    granularStateByID: Record<string, GranularState> = {}

    #catalogsFname: Record<string, string> = {}
    #urlPatternKeys: Record<string, string> = {}
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
        if (typeof adapter.url?.localize === 'function') {
            this.localizeUrl = adapter.url.localize
        } else if (adapter.url?.localize) {
            this.localizeUrl = localizeDefault
        }
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

    #getImportPath(filename: string, importer?: string) {
        filename = relative(dirname(importer ?? filename), filename)
        if (platform === 'win32') {
            filename = filename.replaceAll('\\', '/')
        }
        if (!filename.startsWith('.')) {
            filename = `./${filename}`
        }
        return filename
    }

    getLoadIDs(forImport = false): string[] {
        const loadIDs: string[] = []
        if (this.#adapter.granularLoad) {
            for (const state of Object.values(this.granularStateByID)) {
                // only the ones with ready messages
                if (state.compiled[this.#config.sourceLocale].items.length) {
                    loadIDs.push(state.id)
                }
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
                importsByLocale.push(`${objKeyLocale(loc)}: () => import('${this.#getImportPath(this.getCompiledFilePath(loc, loadIDsImport[i]))}')`)
            }
            imports.push(`${id}: {${importsByLocale.join(',')}}`)
        }
        return `
            /** @type {{[loadID: string]: {[locale: string]: () => Promise<import('wuchale/runtime').CatalogModule>}}} */
            const catalogs = {${imports.join(',')}}
            export const loadCatalog = (/** @type {string} */ loadID, /** @type {string} */ locale) => catalogs[loadID][locale]()
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
                imports.push(`import * as ${locKey} from '${this.#getImportPath(this.getCompiledFilePath(loc, loadIDsImport[il]))}'`)
                importedByLocale.push(`${objKeyLocale(loc)}: ${locKey}`)
            }
            object.push(`${id}: {${importedByLocale.join(',')}}`)
        }
        return `
            ${imports.join('\n')}
            /** @type {{[loadID: string]: {[locale: string]: import('wuchale/runtime').CatalogModule}}} */
            const catalogs = {${object.join(',')}}
            export const loadCatalog = (/** @type {string} */ loadID, /** @type {string} */ locale) => catalogs[loadID][locale]
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
                .replace('${DATA}', `./${dataFileName}`)
                .replace('${KEY}', this.key)
            await writeFile(this.loaderPath[side], loaderContent)
        }
        await writeFile(join(this.#adapter.localesDir, dataFileName), this.getData())
    }

    urlPatternFromTranslate = (patternTranslated: string, keys: Token[]) => {
        const compiledTranslatedPatt = compileTranslation(patternTranslated, patternTranslated)
        if (typeof compiledTranslatedPatt === 'string') {
            return compiledTranslatedPatt
        }
        const urlTokens: Token[] = (compiledTranslatedPatt as Mixed).map(part => {
            if (typeof part === 'number') {
                return keys[part]
            }
            return {type: 'text', value: part}
        })
        return stringify({tokens: urlTokens})
    }

    writeUrlFiles = async () => {
        const patterns = this.#adapter.url?.patterns
        if (!patterns) {
            return
        }
        const manifest: URLManifest = patterns.map(patt => {
            const catalogPattKey = this.#urlPatternKeys[patt]
            const {keys} = pathToRegexp(patt)
            return [
                patt,
                this.#locales.map(loc => {
                    let pattern = patt
                    const item = this.sharedState.poFilesByLoc[loc].catalog[catalogPattKey]
                    if (item) {
                        const patternTranslated = item.msgstr[0] || item.msgid
                        pattern = this.urlPatternFromTranslate(patternTranslated, keys)
                    }
                    return this.localizeUrl?.(pattern, loc) ?? pattern
                })
            ]
        })
        const urlManifestData = [
            `/** @type {import('wuchale/url').URLManifest} */`,
            `export default ${JSON.stringify(manifest)}`,
        ].join('\n')
        await writeFile(this.#urlManifestFname, urlManifestData)
        const urlFileContent = [
            'import {URLMatcher, getLocaleDefault} from "wuchale/url"',
            `import {locales} from "./${dataFileName}"`,
            `import manifest from "./${relative(dirname(this.#urlsFname), this.#urlManifestFname)}"`,
            `export const getLocale = (/** @type {URL} */ url) => getLocaleDefault(url, locales) ?? '${this.#config.sourceLocale}'`,
            `export const matchUrl = URLMatcher(manifest, locales)`
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
        await this.initUrlPatterns()
        if (this.#mode === 'build') {
            await this.directScanFS(false, false)
        }
    }

    urlPatternToTranslate = (pattern: string) => {
        const {keys} = pathToRegexp(pattern)
        const compile = compileUrlPattern(pattern, {encode: false})
        const paramsReplace = {}
        for (const [i, {name}] of keys.entries()) {
            paramsReplace[name] = `{${i}}`
        }
        return compile(paramsReplace)
    }

    initUrlPatterns = async () => {
        for (const loc of this.#locales) {
            const catalog = this.sharedState.poFilesByLoc[loc].catalog
            const urlPatterns = this.#adapter.url?.patterns ?? []
            const urlPatternsForTranslate = urlPatterns.map(this.urlPatternToTranslate)
            const urlPatternMsgs = urlPatterns.map((patt, i) => {
                const locPattern = urlPatternsForTranslate[i]
                let context = null
                if (locPattern !== patt) {
                    context = `original: ${patt}`
                }
                return new Message(locPattern, null, context)
            })
            const urlPatternCatKeys = urlPatternMsgs.map(msg => msg.toKey())
            for (const [key, item] of Object.entries(catalog)) {
                if (!item.flags[urlPatternFlag]) {
                    continue
                }
                if (!urlPatternCatKeys.includes(key)) {
                    item.references = item.references.filter(r => r !== this.key)
                    if (item.references.length === 0) {
                        item.obsolete = true
                    }
                }
            }
            const untranslated: ItemType[] = []
            let needWriteCatalog = false
            for (const [i, locPattern] of urlPatternsForTranslate.entries()) {
                const key = urlPatternCatKeys[i]
                this.#urlPatternKeys[urlPatterns[i]] = key // save for href translate
                if (locPattern.search(/\p{L}/u) === -1) {
                    continue
                }
                let item = catalog[key]
                if (!item || !item.flags[urlPatternFlag]) {
                    item = new PO.Item()
                    needWriteCatalog = true
                }
                item.msgid = locPattern
                if (loc === this.#config.sourceLocale) {
                    item.msgstr = [locPattern]
                }
                if (!item.references.includes(this.key)) {
                    item.references.push(this.key)
                    item.references.sort()
                    needWriteCatalog = true
                }
                item.msgctxt = urlPatternMsgs[i].context
                item.flags[urlPatternFlag] = true
                item.obsolete = false
                catalog[key] = item
                if (!item.msgstr[0]) {
                    untranslated.push(item)
                }
            }
            if (untranslated.length && loc !== this.#config.sourceLocale) {
                this.#geminiQueue[loc].add(untranslated)
                await this.#geminiQueue[loc].running
            }
            if (needWriteCatalog) {
                await this.savePoAndCompile(loc)
            }
        }
        await this.writeUrlFiles()
    }

    loadCatalogNCompile = async (loc: string) => {
        if (this.sharedState.ownerKey === this.key) {
            try {
                this.sharedState.poFilesByLoc[loc] = await loadCatalogFromPO(this.#catalogsFname[loc])
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw err
                }
                this.#log.warn(`${color.magenta(this.key)}: Catalog not found for ${color.cyan(loc)}`)
            }
        }
        await this.compile(loc)
    }

    loadCatalogModule = (locale: string, loadID: string, hmrVersion = -1) => {
        let compiledData = this.sharedState.compiled[locale]
        if (this.#adapter.granularLoad) {
            compiledData = this.granularStateByID[loadID]?.compiled?.[locale] ?? { hasPlurals: false, items: [] }
        }
        const compiledItems = JSON.stringify(compiledData.items)
        const plural = `n => ${this.sharedState.poFilesByLoc[locale].pluralRule.plural}`
        let module = `/** @type import('wuchale').CompiledElement[] */\nexport let ${catalogVarName} = ${compiledItems}`
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
            // @ts-ignore
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
                let compiledLoaded: {[loc: string]: Compiled} = {}
                state = {
                    id,
                    compiled: Object.fromEntries(this.#locales.map(loc => {
                        return [loc, compiledLoaded[loc] ?? {
                            hasPlurals: false,
                            items: [],
                        }]
                    })),
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
        // e.g. key: /items/foo/{0}
        const catalog = this.sharedState.poFilesByLoc[locale].catalog
        let toCompile = key
        const relevantPattern = this.matchUrl(key)
        if (relevantPattern == null) {
            return toCompile
        }
        // e.g. relevantPattern: /items/:rest
        const patternItem = catalog[this.#urlPatternKeys[relevantPattern]]
        if (patternItem) {
            // e.g. patternItem.msgid: /items/{0}
            const matchedUrl = matchUrlPattern(relevantPattern, {decode: false})(key)
            // e.g. matchUrl.params: {rest: 'foo/{0}'}
            if (matchedUrl) {
                const translatedPattern = patternItem.msgstr[0] || patternItem.msgid
                // e.g. translatedPattern: /elementos/{0}
                const {keys} = pathToRegexp(relevantPattern)
                const translatedPattUrl = this.urlPatternFromTranslate(translatedPattern, keys)
                // e.g. translatedPattUrl: /elementos/:rest
                const compileTranslated = compileUrlPattern(translatedPattUrl, {encode: false})
                toCompile = compileTranslated(matchedUrl.params)
                // e.g. toCompile: /elementos/foo/{0}
            }
        }
        if (this.localizeUrl) {
            toCompile = this.localizeUrl(toCompile || key, locale)
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
        const options = { ignore: [ this.#adapter.localesDir ] }
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
        ]
        for (const [key, val] of updateHeaders) {
            fullHead[key] = val
        }
        const now = new Date().toISOString()
        const defaultHeaders = [
            ['POT-Creation-Date', now],
            ['PO-Revision-Date', now],
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
        if (this.#mode === 'cli') { // save for the end
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

    #getRuntimeVars = (): CatalogExpr => ({
        plain: this.#adapter.getRuntimeVars?.plain ?? getFuncPlainDefault,
        reactive: this.#adapter.getRuntimeVars?.reactive ?? getFuncReactiveDefault,
    })

    #prepareHeader = (filename: string, loadID: string, hmrData: HMRData, forServer: boolean): string => {
        let head = []
        const getRuntimeVars = this.#getRuntimeVars()
        let getRuntimePlain = getRuntimeVars.plain
        let getRuntimeReactive = getRuntimeVars.reactive
        if (hmrData != null) {
            head.push(`const ${varNames.hmrUpdate} = ${JSON.stringify(hmrData)}`)
            getRuntimePlain += 'hmr_'
            getRuntimeReactive += 'hmr_'
            head.push(
                this.#hmrUpdateFunc(getRuntimeVars.plain, getRuntimePlain),
                this.#hmrUpdateFunc(getRuntimeVars.reactive, getRuntimeReactive),
            )
        }
        let loaderRelTo = filename
        if (this.#adapter.outDir) {
            loaderRelTo = resolve(this.#adapter.outDir + '/' + filename)
        }
        const loaderPath = this.#getImportPath(forServer ? this.loaderPath.server : this.loaderPath.client, loaderRelTo)
        const importsFuncs = [
            `${loaderImportGetRuntime} as ${getRuntimePlain}`,
            `${loaderImportGetRuntimeRx} as ${getRuntimeReactive}`,
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
            const importFrom = this.#getImportPath(this.getCompiledFilePath(loc, loadID), loaderRelTo)
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
        const importLoaderVars = this.#getRuntimeVars()
        if (this.#adapter.bundleLoad) {
            return {
                plain: `${importLoaderVars.plain}(${bundleCatalogsVarName})`,
                reactive: `${importLoaderVars.reactive}(${bundleCatalogsVarName})`,
            }
        }
        return {
            plain: `${importLoaderVars.plain}('${loadID}')`,
            reactive: `${importLoaderVars.reactive}('${loadID}')`,
        }
    }

    handleMessages = async (loc: string, msgs: Message[], filename: string): Promise<string[]> => {
        const poFile = this.sharedState.poFilesByLoc[loc]
        const extractedUrls = this.sharedState.extractedUrls[loc]
        const previousReferences: Record<string, {count: number, indices: number[]}> = {}
        for (const item of Object.values(poFile.catalog)) {
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
        const hmrKeys = []
        const untranslated: ItemType[] = []
        let newRefs = false
        let newUrlRefs = false
        let commentsChanged = false
        for (const msgInfo of msgs) {
            const key = msgInfo.toKey()
            hmrKeys.push(key)
            const collection = msgInfo.type === 'url' ? extractedUrls : poFile.catalog
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
                if (msgInfo.type !== 'url') {
                    newItems = true
                }
            }
            if (msgInfo.context) {
                poItem.msgctxt = msgInfo.context
            }
            const newComments = msgInfo.comments.map(c => c.replace(/\s+/g, ' ').trim())
            let iStartComm: number
            if (key in previousReferences) {
                const prevRef = previousReferences[key]
                iStartComm = prevRef.indices.shift() * newComments.length // cannot be pop for determinism
                const prevComments = poItem.extractedComments.slice(iStartComm, iStartComm + newComments.length)
                if (prevComments.length !== newComments.length || prevComments.some((c, i) => c !== newComments[i])) {
                    commentsChanged = true
                }
                if (prevRef.indices.length === 0) {
                    delete previousReferences[key]
                }
            } else {
                poItem.references.push(filename)
                poItem.references.sort() // make deterministic
                iStartComm = poItem.references.lastIndexOf(filename) * newComments.length
                if (msgInfo.type === 'message') {
                    newRefs = true // now it references it
                } else {
                    newUrlRefs = true // no write needed but just compile
                }
            }
            if (newComments.length) {
                poItem.extractedComments.splice(iStartComm, newComments.length, ...newComments)
            }
            poItem.obsolete = false
            if (msgInfo.type === 'url') {
                poItem.flags[urlExtractedFlag] = true // included in compiled, but not written to po file
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
        if (newUrlRefs) {
            await this.compile(loc)
        }
        if (untranslated.length === 0) {
            if (newRefs || removedRefs.length || commentsChanged) {
                await this.savePoAndCompile(loc)
            }
            return hmrKeys
        }
        if (loc === this.#config.sourceLocale || !this.#geminiQueue[loc]?.ai) {
            if (newItems || newRefs || commentsChanged) {
                await this.savePoAndCompile(loc)
            }
            return hmrKeys
        }
        this.#geminiQueue[loc].add(untranslated)
        await this.#geminiQueue[loc].running
        return hmrKeys
    }

    transform = async (content: string, filename: string, hmrVersion = -1, forServer = false, direct = false): Promise<TransformOutputCode> => {
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
        let hmrData: HMRData = null
        if (this.#mode !== 'build' || direct) {
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
                hmrKeys[loc] = await this.handleMessages(loc, msgs, filename)
            }
            if (msgs.length && hmrVersion >= 0) {
                hmrData = { version: hmrVersion, data: {} }
                for (const loc of this.#locales) {
                    hmrData.data[loc] = hmrKeys[loc]?.map(key => {
                        const index = indexTracker.get(key)
                        return [ index, compiled[loc].items[index] ]
                    })
                }
            }
        }
        let output: TransformOutputCode = {}
        if (msgs.length) {
            output = result.output(this.#prepareHeader(filename, loadID, hmrData, forServer))
        }
        await this.writeTransformed(filename, output.code ?? content)
        return output
    }

    directFileHandler() {
        const adapterName = color.magenta(this.key)
        return async (filename: string) => {
            console.info(`${adapterName}: Extract from ${color.cyan(filename)}`)
            const contents = await readFile(filename)
            await this.transform(contents.toString(), filename, undefined, undefined, true)
        }
    }

    async directScanFS(clean: boolean, sync: boolean) {
        const dumps: Record<string, string> = {}
        for (const loc of this.#locales) {
            const items = Object.values(this.sharedState.poFilesByLoc[loc].catalog)
            dumps[loc] = poDumpToString(items)
            if (clean) {
                for (const item of items) {
                    // unreference all references that belong to this adapter
                    if (item.flags[urlPatternFlag]) {
                        item.references = item.references.filter(ref => ref !== this.key)
                    } else {
                        // don't touch other adapters' files. related extracted comments handled by handler
                        item.references = item.references.filter(ref => !this.fileMatches(ref))
                    }
                }
            }
            await this.initUrlPatterns()
        }
        const filePaths = await glob(...this.globConfToArgs(this.#adapter.files))
        const extract = this.directFileHandler()
        if (sync) {
            for (const fPath of filePaths) {
                await extract(fPath)
            }
        } else {
            await Promise.all(filePaths.map(extract))
        }
        if (clean) {
            console.info('Cleaning...')
        }
        for (const loc of this.#locales) {
            if (clean) {
                const catalog = this.sharedState.poFilesByLoc[loc].catalog
                for (const [key, item] of Object.entries(catalog)) {
                    if (item.references.length === 0) {
                        delete catalog[key]
                    }
                }
            }
            const newDump = poDumpToString(Object.values(this.sharedState.poFilesByLoc[loc].catalog))
            if (newDump !== dumps[loc]) {
                await this.savePO(loc)
            }
        }
    }

}
