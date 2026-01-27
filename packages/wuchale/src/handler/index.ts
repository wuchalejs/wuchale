import { mkdir, readFile, statfs, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { platform } from 'node:process'
import {
    compile as compileUrlPattern,
    match as matchUrlPattern,
    pathToRegexp,
    stringify,
    type Token,
} from 'path-to-regexp'
import pm, { type Matcher } from 'picomatch'
import PO from 'pofile'
import { glob } from 'tinyglobby'
import { varNames } from '../adapter-utils/index.js'
import type { Adapter, CatalogExpr, GlobConf, HMRData, LoaderPath } from '../adapters.js'
import { IndexTracker, Message } from '../adapters.js'
import AIQueue from '../ai/index.js'
import { type CompiledElement, compileTranslation, type Mixed } from '../compile.js'
import { type ConfigPartial, getLanguageName } from '../config.js'
import { color, type Logger } from '../log.js'
import { catalogVarName } from '../runtime.js'
import { localizeDefault, type URLLocalizer, type URLManifest } from '../url.js'
import {
    type Catalog,
    defaultPluralRule,
    type ItemType,
    loadCatalogFromPO,
    POFile,
    poDumpToString,
    saveCatalogToPO,
} from './pofile.js'

const dataFileName = 'data.js'
const generatedDir = '.wuchale'
export const urlPatternFlag = 'url-pattern'
const urlExtractedFlag = 'url-extracted'

const loaderImportGetRuntime = 'getRuntime'
const loaderImportGetRuntimeRx = 'getRuntimeRx'

const getFuncPlainDefault = '_w_load_'
const getFuncReactiveDefault = getFuncPlainDefault + 'rx_'
const bundleCatalogsVarName = '_w_catalogs_'

const objKeyLocale = (locale: string) => (locale.includes('-') ? `'${locale}'` : locale)

export function normalizeSep(path: string) {
    if (platform !== 'win32') {
        return path
    }
    return path.replaceAll('\\', '/')
}

export type Mode = 'dev' | 'build' | 'cli'

type Compiled = {
    hasPlurals: boolean
    items: CompiledElement[]
}

type CompiledCatalogs = Map<string, Compiled>

type SharedState = {
    ownerKey: string
    sourceLocale: string
    otherFileMatches: Matcher[]
    poFilesByLoc: Map<string, POFile>
    compiled: CompiledCatalogs
    extractedUrls: Map<string, Catalog>
    indexTracker: IndexTracker
}

/* shared states among multiple adapters handlers, by localesDir */
export type SharedStates = Map<string, SharedState>

type GranularState = {
    id: string
    compiled: CompiledCatalogs
    indexTracker: IndexTracker
}

type TransformOutputCode = { code?: string; map?: any }

export class AdapterHandler {
    key: string
    /** config.locales and adapter's sourceLocale */
    #allLocales: string[]
    #sourceLocale: string

    // paths
    loaderPath: LoaderPath
    proxyPath: string
    proxySyncPath: string

    #config: ConfigPartial
    fileMatches: Matcher
    localizeUrl?: URLLocalizer
    #projectRoot: string

    #adapter: Adapter

    /* Shared state with other adapter handlers */
    sharedState: SharedState

    granularStateByFile: Map<string, GranularState> = new Map()
    granularStateByID: Map<string, GranularState> = new Map()

    #catalogsFname: Map<string, string> = new Map()
    #urlPatternKeys: Map<string, string> = new Map()
    #urlManifestFname: string
    #urlsFname: string
    #generatedDir: string
    catalogPathsToLocales: Map<string, string> = new Map()

    #mode: Mode
    #aiQueues: Map<string, AIQueue> = new Map()

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
        this.fileMatches = pm(...this.globConfToArgs(this.#adapter.files))
        this.#allLocales = [...this.#config.locales]
        this.#sourceLocale = this.#adapter.sourceLocale ?? this.#config.locales[0]
        if (!this.#allLocales.includes(this.#sourceLocale)) {
            this.#allLocales.push(this.#sourceLocale)
        }
    }

    getLoaderPaths(): LoaderPath[] {
        const loaderPathHead = join(this.#adapter.localesDir, `${this.key}.loader`)
        const paths: LoaderPath[] = []
        for (const ext of this.#adapter.loaderExts) {
            const pathClient = loaderPathHead + ext
            const same = { client: pathClient, server: pathClient }
            const diff = { client: pathClient, server: loaderPathHead + '.server' + ext }
            if (this.#adapter.defaultLoaderPath == null) {
                paths.push(diff, same)
            } else if (typeof this.#adapter.defaultLoaderPath === 'string') {
                // same file for both
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
        const namePart = `${this.key}.proxy`
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
        filename = normalizeSep(relative(dirname(importer ?? filename), filename))
        if (!filename.startsWith('.')) {
            filename = `./${filename}`
        }
        return filename
    }

    getLoadIDs(forImport = false): string[] {
        const loadIDs: string[] = []
        if (this.#adapter.granularLoad) {
            for (const state of this.granularStateByID.values()) {
                // only the ones with ready messages
                if (state.compiled.get(this.#sourceLocale)!.items.length) {
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

    // typed to work regardless of user's noUncheckedIndexedAccess setting in tsconfig
    genProxy(catalogs: string[], loadIDs: string[], syncImports?: string[]) {
        const baseType = 'import("wuchale/runtime").CatalogModule'
        return `
            ${syncImports?.join('\n') ?? ''}
            /** @typedef {${syncImports ? baseType : `() => Promise<${baseType}>`}} CatalogMod */
            /** @typedef {{[locale: string]: CatalogMod}} KeyCatalogs */
            /** @type {{[loadID: string]: KeyCatalogs}} */
            const catalogs = {${catalogs.join(',')}}
            export const loadCatalog = (/** @type {string} */ loadID, /** @type {string} */ locale) => {
                return /** @type {CatalogMod} */ (/** @type {KeyCatalogs} */ (catalogs[loadID])[locale])${syncImports ? '' : '()'}
            }
            export const loadIDs = ['${loadIDs.join("', '")}']
        `
    }

    getProxy() {
        const imports: string[] = []
        const loadIDs = this.getLoadIDs()
        const loadIDsImport = this.getLoadIDs(true)
        for (const [i, id] of loadIDs.entries()) {
            const importsByLocale: string[] = []
            for (const loc of this.#config.locales) {
                importsByLocale.push(
                    `${objKeyLocale(loc)}: () => import('${this.#getImportPath(this.getCompiledFilePath(loc, loadIDsImport[i]))}')`,
                )
            }
            imports.push(`${id}: {${importsByLocale.join(',')}}`)
        }
        return this.genProxy(imports, loadIDs)
    }

    getProxySync() {
        const loadIDs = this.getLoadIDs()
        const loadIDsImport = this.getLoadIDs(true)
        const imports: string[] = []
        const object: string[] = []
        for (const [il, id] of loadIDs.entries()) {
            const importedByLocale: string[] = []
            for (const [i, loc] of this.#config.locales.entries()) {
                const locKey = `_w_c_${id}_${i}_`
                imports.push(
                    `import * as ${locKey} from '${this.#getImportPath(this.getCompiledFilePath(loc, loadIDsImport[il]))}'`,
                )
                importedByLocale.push(`${objKeyLocale(loc)}: ${locKey}`)
            }
            object.push(`${id}: {${importedByLocale.join(',')}}`)
        }
        return this.genProxy(object, loadIDs, imports)
    }

    getData() {
        return [
            `export const sourceLocale = '${this.#sourceLocale}'`,
            `export const locales = ['${this.#config.locales.join("','")}']`,
        ].join('\n')
    }

    catalogFileName = (locale: string): string => {
        let catalog = join(this.#adapter.localesDir, `${locale}.po`)
        if (!isAbsolute(catalog)) {
            catalog = normalize(`${this.#projectRoot}/${catalog}`)
        }
        return normalizeSep(catalog)
    }

    #initFiles = async () => {
        if (this.#adapter.defaultLoaderPath == null) {
            // using custom loaders
            return
        }
        await mkdir(this.#generatedDir, { recursive: true })
        for (const side in this.loaderPath) {
            let loaderTemplate: string
            if (typeof this.#adapter.defaultLoaderPath === 'string') {
                loaderTemplate = this.#adapter.defaultLoaderPath
            } else {
                loaderTemplate = this.#adapter.defaultLoaderPath[side]
            }
            const loaderContent = (await readFile(loaderTemplate))
                .toString()
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
            return { type: 'text', value: part }
        })
        return stringify({ tokens: urlTokens })
    }

    writeUrlFiles = async () => {
        const patterns = this.#adapter.url?.patterns
        if (!patterns) {
            return
        }
        const manifest: URLManifest = patterns.map(patt => {
            const catalogPattKey = this.#urlPatternKeys.get(patt)!
            const { keys } = pathToRegexp(patt)
            return [
                patt,
                this.#config.locales.map(loc => {
                    let pattern = patt
                    const item = this.sharedState.poFilesByLoc.get(loc)!.catalog.get(catalogPattKey)
                    if (item) {
                        const patternTranslated = item.msgstr[0] || item.msgid
                        pattern = this.urlPatternFromTranslate(patternTranslated, keys)
                    }
                    return this.localizeUrl?.(pattern, loc) ?? pattern
                }),
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
            `export const getLocale = (/** @type {URL} */ url) => getLocaleDefault(url, locales) ?? '${this.#config.locales[0]}'`,
            `export const matchUrl = URLMatcher(manifest, locales)`,
        ].join('\n')
        await writeFile(this.#urlsFname, urlFileContent)
    }

    init = async (sharedStates: SharedStates) => {
        await this.#initPaths()
        await this.#initFiles()
        const sourceLocaleName = getLanguageName(this.#sourceLocale)
        const sharedState = sharedStates.get(this.#adapter.localesDir)
        if (sharedState == null) {
            this.sharedState = {
                ownerKey: this.key,
                sourceLocale: this.#sourceLocale,
                otherFileMatches: [],
                poFilesByLoc: new Map(),
                indexTracker: new IndexTracker(),
                compiled: new Map(),
                extractedUrls: new Map(),
            }
            sharedStates.set(this.#adapter.localesDir, this.sharedState)
        } else {
            if (sharedState.sourceLocale !== this.#sourceLocale) {
                throw new Error('Adapters with different source locales cannot share catalogs.')
            }
            sharedState.otherFileMatches.push(this.fileMatches)
            this.sharedState = sharedState
        }
        for (const loc of this.#allLocales) {
            this.#catalogsFname.set(loc, this.catalogFileName(loc))
            // for handleHotUpdate
            this.catalogPathsToLocales.set(this.#catalogsFname.get(loc)!, loc)
            if (loc !== this.#sourceLocale && this.#config.ai) {
                this.#aiQueues.set(
                    loc,
                    new AIQueue(
                        sourceLocaleName,
                        getLanguageName(loc),
                        this.#config.ai,
                        async () => await this.savePoAndCompile(loc),
                        this.#log,
                    ),
                )
            }
            if (this.sharedState.ownerKey === this.key) {
                this.sharedState.poFilesByLoc.set(loc, new POFile([], defaultPluralRule, {}))
                this.sharedState.extractedUrls.set(loc, new Map())
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
        const { keys } = pathToRegexp(pattern)
        const compile = compileUrlPattern(pattern, { encode: false })
        const paramsReplace = {}
        for (const [i, { name }] of keys.entries()) {
            paramsReplace[name] = `{${i}}`
        }
        return compile(paramsReplace)
    }

    initUrlPatterns = async () => {
        for (const loc of this.#allLocales) {
            const catalog = this.sharedState.poFilesByLoc.get(loc)!.catalog
            const urlPatterns = this.#adapter.url?.patterns ?? []
            const urlPatternsForTranslate = urlPatterns.map(this.urlPatternToTranslate)
            const urlPatternMsgs = urlPatterns.map((patt, i) => {
                const locPattern = urlPatternsForTranslate[i]
                let context: string | undefined
                if (locPattern !== patt) {
                    context = `original: ${patt}`
                }
                return new Message(locPattern, undefined, context)
            })
            const urlPatternCatKeys = urlPatternMsgs.map(msg => msg.toKey())
            for (const [key, item] of catalog.entries()) {
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
                this.#urlPatternKeys.set(urlPatterns[i], key) // save for href translate
                if (locPattern.search(/\p{L}/u) === -1) {
                    continue
                }
                let item = catalog.get(key)
                if (!item || !item.flags[urlPatternFlag]) {
                    item = new PO.Item()
                    needWriteCatalog = true
                }
                item.msgid = locPattern
                if (loc === this.#sourceLocale) {
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
                catalog.set(key, item)
                if (!item.msgstr[0]) {
                    untranslated.push(item)
                }
            }
            if (untranslated.length && loc !== this.#sourceLocale) {
                const aiQueue = this.#aiQueues.get(loc)!
                aiQueue.add(untranslated)
                await aiQueue.running
            }
            if (needWriteCatalog) {
                await this.savePoAndCompile(loc)
            }
        }
        await this.writeUrlFiles()
    }

    loadCatalogNCompile = async (loc: string, hmrVersion = -1) => {
        if (this.sharedState.ownerKey === this.key) {
            try {
                this.sharedState.poFilesByLoc.set(loc, await loadCatalogFromPO(this.#catalogsFname.get(loc)!))
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw err
                }
                this.#log.warn(`${color.magenta(this.key)}: Catalog not found for ${color.cyan(loc)}`)
            }
        }
        await this.compile(loc, hmrVersion)
    }

    loadCatalogModule = (locale: string, loadID: string | null, hmrVersion: number) => {
        let compiledData = this.sharedState.compiled.get(locale)!
        if (this.#adapter.granularLoad) {
            compiledData = (loadID && this.granularStateByID.get(loadID)?.compiled?.get(locale)) || {
                hasPlurals: false,
                items: [],
            }
        }
        const compiledItems = JSON.stringify(compiledData.items)
        const plural = `(/** @type number */ n) => ${this.sharedState.poFilesByLoc.get(locale)!.pluralRule.plural}`
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
        let state = this.granularStateByFile.get(filename)!
        if (state == null) {
            const id = this.#adapter.generateLoadID(filename)
            const stateG = this.granularStateByID.get(id)
            if (stateG) {
                state = stateG
            } else {
                const compiledLoaded: Map<string, Compiled> = new Map()
                state = {
                    id,
                    compiled: new Map(),
                    indexTracker: new IndexTracker(),
                }
                for (const loc of this.#allLocales) {
                    state.compiled.set(
                        loc,
                        compiledLoaded.get(loc) ?? {
                            hasPlurals: false,
                            items: [],
                        },
                    )
                }
                this.granularStateByID.set(id, state)
                await this.writeProxies()
            }
            this.granularStateByFile.set(filename, state)
        }
        return state
    }

    matchUrl = (url: string) => {
        for (const pattern of this.#adapter.url?.patterns ?? []) {
            if (matchUrlPattern(pattern, { decode: false })(url)) {
                return pattern
            }
        }
        return null
    }

    getUrlToCompile = (key: string, locale: string) => {
        // e.g. key: /items/foo/{0}
        const catalog = this.sharedState.poFilesByLoc.get(locale)!.catalog
        let toCompile = key
        const relevantPattern = this.matchUrl(key)
        if (relevantPattern == null) {
            return toCompile
        }
        // e.g. relevantPattern: /items/:rest
        const patternItem = catalog.get(this.#urlPatternKeys.get(relevantPattern) ?? '')
        if (patternItem) {
            // e.g. patternItem.msgid: /items/{0}
            const matchedUrl = matchUrlPattern(relevantPattern, { decode: false })(key)
            // e.g. matchUrl.params: {rest: 'foo/{0}'}
            if (matchedUrl) {
                const translatedPattern = patternItem.msgstr[0] || patternItem.msgid
                // e.g. translatedPattern: /elementos/{0}
                const { keys } = pathToRegexp(relevantPattern)
                const translatedPattUrl = this.urlPatternFromTranslate(translatedPattern, keys)
                // e.g. translatedPattUrl: /elementos/:rest
                const compileTranslated = compileUrlPattern(translatedPattUrl, { encode: false })
                toCompile = compileTranslated(matchedUrl.params)
                // e.g. toCompile: /elementos/foo/{0}
            }
        }
        if (this.localizeUrl) {
            toCompile = this.localizeUrl(toCompile || key, locale)
        }
        return toCompile
    }

    compile = async (loc: string, hmrVersion = -1) => {
        let sharedCompiledLoc = this.sharedState.compiled.get(loc)
        if (sharedCompiledLoc == null) {
            sharedCompiledLoc = { hasPlurals: false, items: [] }
            this.sharedState.compiled.set(loc, sharedCompiledLoc)
        }
        const sharedCompiledSourceItems = this.sharedState.compiled.get(this.#sourceLocale)?.items // ?. for sourceLocale itself
        const catalog = this.sharedState.poFilesByLoc.get(loc)!.catalog
        for (const [key, poItem] of [...catalog.entries(), ...this.sharedState.extractedUrls.get(loc)!.entries()]) {
            if (poItem.flags[urlPatternFlag]) {
                // useless in compiled catalog
                continue
            }
            // compile only if it came from a file under this adapter
            if (!poItem.references.some(f => this.fileMatches(f))) {
                continue
            }
            const index = this.sharedState.indexTracker.get(key)
            let compiled: CompiledElement
            const fallback = sharedCompiledSourceItems?.[index] ?? ''
            if (poItem.msgid_plural) {
                sharedCompiledLoc.hasPlurals = true
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
            sharedCompiledLoc.items[index] = compiled
            if (!this.#adapter.granularLoad) {
                continue
            }
            for (const fname of poItem.references) {
                const state = await this.#getGranularState(fname)
                const compiledLoc = state.compiled.get(loc)!
                compiledLoc.hasPlurals = sharedCompiledLoc.hasPlurals
                compiledLoc.items[state.indexTracker.get(key)] = compiled
            }
        }
        await this.writeCompiled(loc, hmrVersion)
    }

    writeCompiled = async (loc: string, hmrVersion = -1) => {
        await writeFile(this.getCompiledFilePath(loc, null), this.loadCatalogModule(loc, null, hmrVersion))
        if (!this.#adapter.granularLoad) {
            return
        }
        for (const state of this.granularStateByID.values()) {
            await writeFile(this.getCompiledFilePath(loc, state.id), this.loadCatalogModule(loc, state.id, hmrVersion))
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
        const options = { ignore: [this.#adapter.localesDir] }
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
        return [patterns.map(normalizeSep), options]
    }

    savePO = async (loc: string) => {
        const poFile = this.sharedState.poFilesByLoc.get(loc)!
        poFile.updateHeaders(loc, this.#sourceLocale)
        await saveCatalogToPO(poFile, this.#catalogsFname.get(loc)!)
    }

    savePoAndCompile = async (loc: string) => {
        this.onBeforeWritePO?.()
        if (this.#mode === 'cli') {
            // save for the end
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

    #prepareHeader = (filename: string, loadID: string, hmrData: HMRData | null, forServer: boolean): string => {
        let head: string[] = []
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
        head = [`import {${importsFuncs.join(', ')}} from "${loaderPath}"`, ...head]
        if (!this.#adapter.bundleLoad) {
            return head.join('\n')
        }
        const imports: string[] = []
        const objElms: string[] = []
        for (const [i, loc] of this.#config.locales.entries()) {
            const locKW = `_w_c_${i}_`
            const importFrom = this.#getImportPath(this.getCompiledFilePath(loc, loadID), loaderRelTo)
            imports.push(`import * as ${locKW} from '${importFrom}'`)
            objElms.push(`${objKeyLocale(loc)}: ${locKW}`)
        }
        return [...imports, ...head, `const ${bundleCatalogsVarName} = {${objElms.join(',')}}`].join('\n')
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
        const poFile = this.sharedState.poFilesByLoc.get(loc)!
        const extractedUrls = this.sharedState.extractedUrls.get(loc)!
        const previousReferences: Map<string, { count: number; indices: number[] }> = new Map()
        for (const item of poFile.catalog.values()) {
            if (!item.references.includes(filename)) {
                continue
            }
            const key = new Message([item.msgid, item.msgid_plural], undefined, item.msgctxt).toKey()
            previousReferences.set(key, { count: 0, indices: [] })
            for (const [i, ref] of item.references.entries()) {
                if (ref !== filename) {
                    continue
                }
                const prevRef = previousReferences.get(key)!
                prevRef.count++
                prevRef.indices.push(i)
            }
        }
        let newItems: boolean = false
        const hmrKeys: string[] = []
        const untranslated: ItemType[] = []
        let newRefs = false
        let newUrlRefs = false
        let commentsChanged = false
        for (const msgInfo of msgs) {
            const key = msgInfo.toKey()
            hmrKeys.push(key)
            const collection = msgInfo.type === 'url' ? extractedUrls : poFile.catalog
            let poItem = collection.get(key)
            if (!poItem) {
                // @ts-expect-error
                poItem = new PO.Item({
                    nplurals: poFile.pluralRule.nplurals,
                })
                poItem.msgid = msgInfo.msgStr[0]
                if (msgInfo.plural) {
                    poItem.msgid_plural = msgInfo.msgStr[1] ?? msgInfo.msgStr[0]
                }
                collection.set(key, poItem)
                if (msgInfo.type !== 'url') {
                    newItems = true
                }
            }
            if (msgInfo.context) {
                poItem.msgctxt = msgInfo.context
            }
            const newComments = msgInfo.comments.map(c => c.replace(/\s+/g, ' ').trim())
            let iStartComm: number
            const prevRef = previousReferences.get(key)
            if (prevRef == null) {
                poItem.references.push(filename)
                poItem.references.sort() // make deterministic
                iStartComm = poItem.references.lastIndexOf(filename) * newComments.length
                if (msgInfo.type === 'message') {
                    newRefs = true // now it references it
                } else {
                    newUrlRefs = true // no write needed but just compile
                }
            } else {
                iStartComm = (prevRef.indices.shift() ?? 0) * newComments.length // cannot be pop for determinism
                const prevComments = poItem.extractedComments.slice(iStartComm, iStartComm + newComments.length)
                if (prevComments.length !== newComments.length || prevComments.some((c, i) => c !== newComments[i])) {
                    commentsChanged = true
                }
                if (prevRef.indices.length === 0) {
                    previousReferences.delete(key)
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
            if (loc === this.#sourceLocale) {
                const msgStr = msgInfo.msgStr.join('\n')
                if (poItem.msgstr.join('\n') !== msgStr) {
                    poItem.msgstr = msgInfo.msgStr
                    untranslated.push(poItem)
                }
            } else if (!poItem.msgstr[0]) {
                untranslated.push(poItem)
            }
        }
        const removedRefs = previousReferences.entries()
        for (const [key, info] of removedRefs) {
            const item = poFile.catalog.get(key)!
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
            if (newRefs || previousReferences.size || commentsChanged) {
                await this.savePoAndCompile(loc)
            }
            return hmrKeys
        }
        if (loc === this.#sourceLocale || !this.#aiQueues.get(loc)?.ai) {
            if (newItems || newRefs || commentsChanged) {
                await this.savePoAndCompile(loc)
            }
            return hmrKeys
        }
        const aiQueueLoc = this.#aiQueues.get(loc)!
        aiQueueLoc.add(untranslated)
        await aiQueueLoc.running
        return hmrKeys
    }

    transform = async (
        content: string,
        filename: string,
        hmrVersion = -1,
        forServer = false,
        direct = false,
    ): Promise<TransformOutputCode> => {
        filename = normalizeSep(filename)
        let indexTracker = this.sharedState.indexTracker
        let loadID = this.key
        let compiled = this.sharedState.compiled
        if (this.#adapter.granularLoad) {
            const state = await this.#getGranularState(filename)
            indexTracker = state.indexTracker
            loadID = state.id
            compiled = state.compiled
        }
        const { msgs, ...result } = await this.#adapter.transform({
            content,
            filename,
            index: indexTracker,
            expr: this.#prepareRuntimeExpr(loadID),
            matchUrl: this.matchUrl,
        })
        let hmrData: HMRData | null = null
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
            const hmrKeys: Map<string, string[]> = new Map()
            for (const loc of this.#allLocales) {
                hmrKeys.set(loc, await this.handleMessages(loc, msgs, filename))
            }
            if (msgs.length && hmrVersion >= 0) {
                hmrData = { version: hmrVersion, data: {} }
                for (const loc of this.#config.locales) {
                    hmrData.data[loc] =
                        hmrKeys.get(loc)?.map(key => {
                            const index = indexTracker.get(key)
                            return [index, compiled.get(loc)!.items[index]]
                        }) ?? []
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
            this.#log.info(`${adapterName}: Extract from ${color.cyan(filename)}`)
            const contents = await readFile(filename)
            await this.transform(contents.toString(), filename, undefined, undefined, true)
        }
    }

    async directScanFS(clean: boolean, sync: boolean) {
        const dumps: Map<string, string> = new Map()
        for (const loc of this.#allLocales) {
            const items = Array.from(this.sharedState.poFilesByLoc.get(loc)!.catalog.values())
            dumps.set(loc, poDumpToString(items))
            if (clean) {
                for (const item of items) {
                    // unreference all references that belong to this adapter
                    if (item.flags[urlPatternFlag]) {
                        item.references = item.references.filter(ref => ref !== this.key)
                    } else {
                        // don't touch other adapters' files. related extracted comments handled by handler
                        item.references = item.references.filter(ref => {
                            if (this.fileMatches(ref)) {
                                return false
                            }
                            if (this.sharedState.ownerKey !== this.key) {
                                return true
                            }
                            return this.sharedState.otherFileMatches.some(match => match(ref))
                        })
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
            this.#log.info('Cleaning...')
        }
        for (const loc of this.#allLocales) {
            const catalog = this.sharedState.poFilesByLoc.get(loc)!.catalog
            if (clean) {
                for (const [key, item] of catalog.entries()) {
                    if (item.references.length === 0) {
                        catalog.delete(key)
                    }
                }
            }
            const newDump = poDumpToString(Array.from(catalog.values()))
            if (newDump !== dumps.get(loc)) {
                await this.savePO(loc)
            }
        }
    }
}
