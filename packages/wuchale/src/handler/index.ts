import { resolve } from 'node:path'
import pm, { type Matcher } from 'picomatch'
import { varNames } from '../adapter-utils/index.js'
import type { Adapter, HMRData, RuntimeExpr as RuntimeExpr } from '../adapters.js'
import { Message } from '../adapters.js'
import AIQueue from '../ai/index.js'
import { type CompiledElement, compileTranslation } from '../compile.js'
import { type ConfigPartial, getLanguageName } from '../config.js'
import { type Logger } from '../log.js'
import { type Catalog, type FileRef, type Item, newItem } from '../storage.js'
import { Files, globConfToArgs, normalizeSep, objKeyLocale } from './files.js'
import { type SharedState, SharedStates, State } from './state.js'
import { URLHandler } from './url.js'

const loaderImportGetRuntime = 'getRuntime'
const loaderImportGetRuntimeRx = 'getRuntimeRx'

const getFuncPlainDefault = '_w_load_'
const urlLocalizeUdfName = 'localize'
const getFuncReactiveDefault = getFuncPlainDefault + 'rx_'
const bundleCatalogsVarName = '_w_catalogs_'

export type Mode = 'dev' | 'build' | 'cli'

type TransformOutputCode = { code?: string; map?: any }

export class AdapterHandler {
    key: string

    /** config.locales and adapter's sourceLocale */
    allLocales: string[]
    sourceLocale: string

    #projectRoot: string

    #config: ConfigPartial
    #adapter: Adapter
    fileMatches: Matcher

    /* Shared state with other adapter handlers */
    sharedState: SharedState
    granularState: State

    catalogPathsToLocales: Map<string, string> = new Map()

    // sub handlers
    files: Files
    url: URLHandler

    #mode: Mode
    #aiQueues: Map<string, AIQueue> = new Map()

    #log: Logger

    onBeforeSave: () => void

    constructor(adapter: Adapter, key: string, config: ConfigPartial, mode: Mode, projectRoot: string, log: Logger) {
        this.#adapter = adapter
        this.url = new URLHandler(adapter.url)
        this.key = key
        this.#mode = mode
        this.#projectRoot = projectRoot
        this.#config = config
        this.#log = log
        this.fileMatches = pm(...globConfToArgs(this.#adapter.files, this.#config.localesDir, this.#adapter.outDir))
        this.allLocales = [...this.#config.locales]
        this.sourceLocale = this.#adapter.sourceLocale ?? this.#config.locales[0]
        if (!this.allLocales.includes(this.sourceLocale)) {
            this.allLocales.push(this.sourceLocale)
        }
        this.files = new Files(this.#adapter, this.key, this.#config.localesDir, this.#projectRoot)
    }

    /** return two arrays: the corresponding one, and the one to import from in the case of shared catalogs */
    getLoadIDs(): [string[], string[]] {
        const loadIDs: string[] = []
        if (!this.#adapter.granularLoad) {
            return [[this.key], [this.sharedState.ownerKey]]
        }
        for (const state of this.granularState.byID.values()) {
            // only the ones with ready messages
            if (state.compiled.get(this.sourceLocale)!.items.length) {
                loadIDs.push(state.id)
            }
        }
        return [loadIDs, loadIDs]
    }

    initUrlPatterns = async (loc: string, catalog: Catalog) => {
        const aiQueue = this.#aiQueues.get(loc)
        return await this.url.initPatterns(loc, this.sourceLocale, this.key, catalog, aiQueue)
    }

    initSharedState = (sharedStates: SharedStates) => {
        const storage = this.#adapter.storage({
            locales: this.allLocales,
            root: this.#projectRoot,
            sourceLocale: this.sourceLocale,
            localesDir: this.#config.localesDir,
            adapterKey: this.key,
            haveUrl: this.#adapter.url != null,
            log: this.#log,
        })
        this.sharedState = sharedStates.getAdd(storage, this.key, this.sourceLocale, this.fileMatches)
    }

    init = async (sharedStates: SharedStates) => {
        const sourceLocaleName = getLanguageName(this.sourceLocale)
        this.initSharedState(sharedStates)
        await this.files.init(this.#config.locales, this.sharedState.ownerKey, this.sourceLocale)
        const writeProxies = () => this.files.writeProxies(this.#config.locales, ...this.getLoadIDs())
        this.granularState = new State(writeProxies, this.#adapter.generateLoadID)
        const catalogsArray: Catalog[] = []
        for (const loc of this.allLocales) {
            await this.loadCatalogNCompile(loc)
            const storage = this.sharedState.storage.get(loc)!
            // for handleHotUpdate
            for (const file of storage.files) {
                this.catalogPathsToLocales.set(normalizeSep(file), loc)
            }
            if (await this.initUrlPatterns(loc, storage.catalog)) {
                await this.saveAndCompile(loc)
            }
            catalogsArray.push(storage.catalog)
            if (loc === this.sourceLocale || !this.#config.ai) {
                continue
            }
            this.#aiQueues.set(
                loc,
                new AIQueue(
                    sourceLocaleName,
                    getLanguageName(loc),
                    this.#config.ai,
                    async () => await this.saveAndCompile(loc),
                    this.#log,
                ),
            )
        }
        await writeProxies()
        await this.files.writeUrlFiles(this.url.buildManifest(catalogsArray), this.#config.locales[0])
    }

    loadCatalogNCompile = async (loc: string, hmrVersion = -1) => {
        if (this.sharedState.ownerKey === this.key) {
            await this.sharedState.storage.get(loc).load()
        }
        await this.compile(loc, hmrVersion)
    }

    writeCompiled = async (loc: string, hmrVersion = -1) => {
        let compiledData = this.sharedState.compiled.get(loc)!
        const pluralRule = this.sharedState.storage.get(loc).pluralRule.plural
        const hmrVersionMode = this.#mode === 'dev' ? hmrVersion : null
        await this.files.writeCatalogModule(
            compiledData.items,
            compiledData.hasPlurals ? pluralRule : null,
            loc,
            hmrVersionMode,
            null,
        )
        if (!this.#adapter.granularLoad) {
            return
        }
        for (const state of this.granularState.byID.values()) {
            compiledData = state.compiled?.get(loc) || {
                hasPlurals: false,
                items: [],
            }
            await this.files.writeCatalogModule(
                compiledData.items,
                compiledData.hasPlurals ? pluralRule : null,
                loc,
                hmrVersionMode,
                state.id,
            )
        }
    }

    getCompiledFallback(index: number, loc: string) {
        for (let _ = 0; _ < 100; _++) {
            // just to be sure
            let fallbackLoc = this.#config.fallback[loc]
            if (fallbackLoc == null) {
                if (loc.includes('-')) {
                    fallbackLoc = new Intl.Locale(loc).language
                }
                if (fallbackLoc == null || !this.allLocales.includes(fallbackLoc)) {
                    fallbackLoc = this.sourceLocale
                }
            }
            const catalog = this.sharedState.compiled.get(fallbackLoc)?.items!
            const compiled = catalog[index]
            if (compiled || fallbackLoc === this.sourceLocale) {
                // last try
                return compiled || ''
            }
            loc = fallbackLoc
        }
        return ''
    }

    compile = async (loc: string, hmrVersion = -1) => {
        let sharedCompiledLoc = this.sharedState.compiled.get(loc)
        if (sharedCompiledLoc == null) {
            sharedCompiledLoc = { hasPlurals: false, items: [] }
            this.sharedState.compiled.set(loc, sharedCompiledLoc)
        }
        const catalog = this.sharedState.storage.get(loc).catalog
        for (const [itemKey, poItem] of catalog.entries()) {
            // compile only if it came from a file under this adapter
            // for urls, skip if not referenced in links
            if (!poItem.references.some(r => this.fileMatches(r.file))) {
                continue
            }
            let keys = [itemKey]
            if (poItem.urlAdapters.length > 0) {
                keys = []
                for (const reference of poItem.references) {
                    if (reference.refs.length === 0) {
                        keys.push(poItem.msgid[0]) // plain url like /home
                        continue
                    }
                    for (const ref of reference.refs) {
                        keys.push(ref[0] ?? poItem.msgid[0]) // first one is the link, rest are placeholders
                    }
                }
            }
            for (const key of keys) {
                const index = this.sharedState.indexTracker.get(key)
                let compiled: CompiledElement
                const fallback = this.getCompiledFallback(index, loc)
                if (poItem.msgstr.length > 1) {
                    sharedCompiledLoc.hasPlurals = true
                    if (poItem.msgstr.join('').trim()) {
                        compiled = poItem.msgstr
                    } else {
                        compiled = fallback
                    }
                } else {
                    let toCompile = poItem.msgstr[0]
                    if (poItem.urlAdapters.length > 0) {
                        toCompile = this.url.matchToCompile(key, catalog)
                    }
                    compiled = compileTranslation(toCompile, fallback)
                }
                sharedCompiledLoc.items[index] = compiled
                if (!this.#adapter.granularLoad) {
                    continue
                }
                for (const ref of poItem.references) {
                    const state = await this.granularState.byFileCreate(ref.file, this.allLocales)
                    const compiledLoc = state.compiled.get(loc)!
                    compiledLoc.hasPlurals = sharedCompiledLoc.hasPlurals
                    compiledLoc.items[state.indexTracker.get(key)] = compiled
                }
            }
        }
        await this.writeCompiled(loc, hmrVersion)
    }

    saveAndCompile = async (loc: string) => {
        this.onBeforeSave?.()
        if (this.#mode === 'cli') {
            // save for the end
            return
        }
        await this.sharedState.storage.get(loc).save()
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

    #getRuntimeVars = (): RuntimeExpr => ({
        plain: this.#adapter.getRuntimeVars?.plain ?? getFuncPlainDefault,
        reactive: this.#adapter.getRuntimeVars?.reactive ?? getFuncReactiveDefault,
    })

    #prepareHeader = (
        filename: string,
        loadID: string,
        hmrData: HMRData | null,
        hasUrls: boolean,
        forServer: boolean,
    ): string => {
        let head: string[] = []
        if (hasUrls) {
            const localize = this.#adapter.url?.localize
            if (localize === true) {
                head.push(`import { localizeDefault as ${varNames.urlLocalize} } from "wuchale/url"`)
            } else if (typeof localize === 'string') {
                const importFrom = this.files.getImportPath(localize, filename)
                head.push(`import { ${urlLocalizeUdfName} as ${varNames.urlLocalize} } from "${importFrom}"`)
            }
        }
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
        const loaderPath = this.files.getImportLoaderPath(forServer, loaderRelTo)
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
            const importFrom = this.files.getImportPath(this.files.getCompiledFilePath(loc, loadID), loaderRelTo)
            imports.push(`import * as ${locKW} from '${importFrom}'`)
            objElms.push(`${objKeyLocale(loc)}: ${locKW}`)
        }
        return [...imports, ...head, `const ${bundleCatalogsVarName} = {${objElms.join(',')}}`].join('\n')
    }

    #prepareRuntimeExpr = (loadID: string): RuntimeExpr => {
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
        const poFile = this.sharedState.storage.get(loc)
        const previousReferences: Map<string, { ref: FileRef; reused: number }> = new Map()
        for (const item of poFile.catalog.values()) {
            const existingRef = item.references.find(r => r.file === filename)
            if (!existingRef) {
                continue
            }
            const key = new Message(item.msgid, undefined, item.context).toKey()
            previousReferences.set(key, { ref: existingRef, reused: 0 })
        }
        let newItems: boolean = false
        const hmrKeys: string[] = []
        const untranslated: Item[] = []
        let newRefs = false
        let commentsChanged = false
        for (const msgInfo of msgs) {
            let key = msgInfo.toKey()
            hmrKeys.push(key)
            if (msgInfo.type === 'url') {
                const matched = this.url.match(key)
                if (!matched) {
                    const err = new Error(`URL ${msgInfo.msgStr[0]} has no matching pattern defined`)
                    ;(err as any).id = filename
                    throw err
                }
                key = this.url.patternKeys.get(matched)! // ! because already checked at extraction
            }
            let poItem = poFile.catalog.get(key)
            if (!poItem) {
                poItem = newItem({ msgid: msgInfo.msgStr })
                poFile.catalog.set(key, poItem)
            }
            const placeholders: string[] = []
            if (msgInfo.type === 'url') {
                const refKey = msgInfo.toKey()
                if (refKey !== key) {
                    placeholders.push(refKey)
                }
            } else if (msgInfo.context) {
                poItem.context = msgInfo.context
            }
            placeholders.push(...msgInfo.placeholders.map(([i, p]) => `${i}: ${p.replace(/\s+/g, ' ').trim()}`))
            const prevRef = previousReferences.get(key)
            if (prevRef == null) {
                poItem.references.push({
                    file: filename,
                    refs: placeholders.length ? [placeholders] : [],
                })
                newRefs = true // now it references it
            } else {
                if (placeholders.length) {
                    prevRef.ref.refs[prevRef.reused] = placeholders
                }
                prevRef.reused++
            }
            if (msgInfo.type === 'url') {
                // already translated or attempted at startup
                continue
            }
            if (loc === this.sourceLocale) {
                const msgStr = msgInfo.msgStr.join('\n')
                if (poItem.msgstr.join('\n') !== msgStr) {
                    poItem.msgstr = msgInfo.msgStr
                    untranslated.push(poItem)
                }
            } else if (!poItem.msgstr[0]) {
                untranslated.push(poItem)
            }
        }
        for (const info of previousReferences.values()) {
            info.ref.refs = info.ref.refs.slice(0, info.reused) // trim unused
        }
        if (untranslated.length === 0) {
            if (newRefs || previousReferences.size || commentsChanged) {
                await this.saveAndCompile(loc)
            }
            return hmrKeys
        }
        if (loc === this.sourceLocale || !this.#aiQueues.get(loc)?.ai) {
            if (newItems || newRefs || commentsChanged) {
                await this.saveAndCompile(loc)
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
    ): Promise<TransformOutputCode> => {
        filename = normalizeSep(filename)
        let indexTracker = this.sharedState.indexTracker
        let loadID = this.key
        let compiled = this.sharedState.compiled
        if (this.#adapter.granularLoad) {
            const state = await this.granularState.byFileCreate(filename, this.allLocales)
            indexTracker = state.indexTracker
            loadID = state.id
            compiled = state.compiled
        }
        const { msgs, ...result } = await this.#adapter.transform({
            content,
            filename,
            index: indexTracker,
            expr: this.#prepareRuntimeExpr(loadID),
            matchUrl: this.url.match,
        })
        let hmrData: HMRData | null = null
        if (this.#mode !== 'build') {
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
            for (const loc of this.allLocales) {
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
            output = result.output(
                this.#prepareHeader(
                    filename,
                    loadID,
                    hmrData,
                    msgs.some(m => m.type === 'url'),
                    forServer,
                ),
            )
        }
        await this.files.writeTransformed(filename, output.code ?? content)
        return output
    }
}
