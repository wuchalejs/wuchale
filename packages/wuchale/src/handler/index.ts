import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import pm, { type Matcher } from 'picomatch'
import { varNames } from '../adapter-utils/index.js'
import type { Adapter, HMRData, Message, RuntimeExpr as RuntimeExpr, TransformOutputCode } from '../adapters.js'
import { getKey } from '../adapters.js'
import AIQueue from '../ai/index.js'
import { type CompiledElement, compileTranslation } from '../compile.js'
import type { ConfigPartial } from '../config.js'
import type { Logger } from '../log.js'
import { type FileRef, type FileRefEntry, type Item, newItem } from '../storage.js'
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

type TrackedRefs = Map<
    string,
    {
        ref: FileRef
        used: number
    }
>

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

    // sub handlers
    files: Files
    url: URLHandler

    #mode: Mode
    #aiQueue: AIQueue

    #log: Logger

    onBeforeSave: () => void

    constructor(adapter: Adapter, key: string, config: ConfigPartial, mode: Mode, projectRoot: string, log: Logger) {
        this.#adapter = adapter
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
        if (this.#config.ai) {
            this.#aiQueue = new AIQueue(
                this.sourceLocale,
                this.#config.ai,
                mode === 'cli' ? this.saveStorage : this.saveStorageCompile,
                this.#log,
            )
        }
        this.url = new URLHandler(this.allLocales, adapter.url)
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

    initSharedState = (sharedStates: SharedStates) => {
        const storage = this.#adapter.storage({
            locales: this.allLocales,
            root: this.#projectRoot,
            sourceLocale: this.sourceLocale,
            haveUrl: this.#adapter.url != null,
        })
        this.sharedState = sharedStates.getAdd(storage, this.key, this.sourceLocale, this.fileMatches)
    }

    init = async (sharedStates: SharedStates) => {
        this.initSharedState(sharedStates)
        await this.files.init(this.#config.locales, this.sharedState.ownerKey, this.sourceLocale)
        const writeProxies = () => this.files.writeProxies(this.#config.locales, ...this.getLoadIDs())
        this.granularState = new State(writeProxies, this.#adapter.generateLoadID)
        await this.loadStorage()
        if (await this.url.initPatterns(this.sourceLocale, this.key, this.sharedState.catalog, this.#aiQueue)) {
            await this.saveStorage()
        }
        await this.compile()
        await writeProxies()
        await this.files.writeUrlFiles(this.url.buildManifest(this.sharedState.catalog), this.#config.locales[0])
    }

    loadStorage = async () => {
        if (this.sharedState.ownerKey === this.key) {
            await this.sharedState.load(this.allLocales)
        }
    }

    saveStorage = async () => {
        this.onBeforeSave?.()
        await this.sharedState.save()
    }

    compile = async (hmrVersion = -1) => {
        await Promise.all(this.allLocales.map(loc => this.#compileForLocale(loc, hmrVersion)))
    }

    saveStorageCompile = async () => {
        await this.saveStorage()
        await this.compile()
    }

    writeCompiled = async (loc: string, hmrVersion = -1) => {
        let compiledData = this.sharedState.compiled.get(loc)!
        const pluralRule = this.sharedState.pluralRules.get(loc)!.plural
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

    #compileForLocale = async (loc: string, hmrVersion = -1) => {
        let sharedCompiledLoc = this.sharedState.compiled.get(loc)
        if (sharedCompiledLoc == null) {
            sharedCompiledLoc = { hasPlurals: false, items: [] }
            this.sharedState.compiled.set(loc, sharedCompiledLoc)
        }
        for (const [itemKey, item] of this.sharedState.catalog) {
            // compile only if it came from a file under this adapter
            // for urls, skip if not referenced in links
            if (!item.references.some(r => this.fileMatches(r.file))) {
                continue
            }
            let keys = [itemKey]
            if (item.urlAdapters.length > 0) {
                keys = []
                for (const reference of item.references) {
                    for (const ref of reference.refs) {
                        keys.push(ref?.link ?? item.id[0])
                    }
                }
            }
            for (const key of keys) {
                const index = this.sharedState.indexTracker.get(key)
                let compiled: CompiledElement
                const fallback = this.getCompiledFallback(index, loc)
                const transl = item.translations.get(loc)!
                if (transl.text.length > 1) {
                    sharedCompiledLoc.hasPlurals = true
                    if (transl.text.join('').trim()) {
                        compiled = transl.text
                    } else {
                        compiled = fallback
                    }
                } else {
                    let toCompile = transl.text[0]
                    if (item.urlAdapters.length > 0) {
                        toCompile = this.url.matchToCompile(key, this.sharedState.catalog, loc)
                    }
                    compiled = compileTranslation(toCompile, fallback)
                }
                sharedCompiledLoc.items[index] = compiled
                if (!this.#adapter.granularLoad) {
                    continue
                }
                for (const ref of item.references) {
                    const state = await this.granularState.byFileCreate(ref.file, this.allLocales)
                    const compiledLoc = state.compiled.get(loc)!
                    compiledLoc.hasPlurals = sharedCompiledLoc.hasPlurals
                    compiledLoc.items[state.indexTracker.get(key)] = compiled
                }
            }
        }
        await this.writeCompiled(loc, hmrVersion)
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

    popTrackedRefs = (filename: string) => {
        const previousReferences: TrackedRefs = new Map()
        for (const item of this.sharedState.catalog.values()) {
            const existingRef = item.references.find(r => r.file === filename)
            if (!existingRef) {
                continue
            }
            previousReferences.set(getKey(item.id, item.context), { ref: existingRef, used: 0 })
        }
        return previousReferences
    }

    updateRef = (item: Item, key: string, filename: string, msgInfo: Message, trackedRefrences: TrackedRefs) => {
        let updated = false
        const newRef: FileRefEntry = {
            placeholders: msgInfo.placeholders.map(([i, p]) => [i, p.replace(/\s+/g, ' ').trim()]),
        }
        if (msgInfo.type === 'url' && getKey(msgInfo.msgStr, msgInfo.context) !== key) {
            newRef.link = msgInfo.msgStr[0]
        }
        const newRefEntry = newRef.link || msgInfo.placeholders.length ? newRef : null
        const prevRef = trackedRefrences.get(key)
        if (prevRef == null) {
            const newFileRef: FileRef = {
                file: filename,
                refs: [newRefEntry],
            }
            // for same file multiple refs, not to create a new FileRef
            trackedRefrences.set(key, { ref: newFileRef, used: 1 })
            item.references.push(newFileRef)
            item.references.sort((r1, r2) => (r1.file < r2.file ? -1 : 1)) // make deterministic
            updated = true // now it references it
        } else {
            const pr = prevRef.ref.refs[prevRef.used]
            if (!newRef.link && pr) {
                delete pr.link
            }
            if (!isDeepStrictEqual(pr, newRefEntry)) {
                updated = true
            }
            prevRef.ref.refs[prevRef.used] = newRefEntry
            prevRef.used++
        }
        return updated
    }

    cleanTrackedRefs = (trackedRefs: TrackedRefs) => {
        let cleaned = false
        for (const [key, info] of trackedRefs) {
            if (info.used < info.ref.refs.length) {
                info.ref.refs = info.ref.refs.slice(0, info.used) // trim unused
                cleaned = true
            }
            if (info.ref.refs.length > 0) {
                continue
            }
            const item = this.sharedState.catalog.get(key)!
            item.references = item.references.filter(ref => ref.refs.length > 0)
            // after this, it can be marked obsolete and cleaned by cli
        }
        return cleaned
    }

    handleMessages = async (msgs: Message[], filename: string): Promise<[string[], boolean]> => {
        const previousReferences = this.popTrackedRefs(filename)
        let updated = false
        const hmrKeys: string[] = []
        const toTranslate: Item[] = []
        for (const msgInfo of msgs) {
            let key = getKey(msgInfo.msgStr, msgInfo.context)
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
            let item = this.sharedState.catalog.get(key)
            if (!item) {
                item = newItem({ id: msgInfo.msgStr }, this.allLocales)
                this.sharedState.catalog.set(key, item)
                updated = true
            }
            if (this.updateRef(item, key, filename, msgInfo, previousReferences)) {
                updated = true
            }
            if (msgInfo.type === 'url') {
                // already translated or attempted at startup
                // and context not to be updated
                continue
            }
            if (msgInfo.context !== item.context) {
                updated = true
            }
            item.context = msgInfo.context
            const sourceTransl = item.translations.get(this.sourceLocale)!
            const msgStr = msgInfo.msgStr.join('\n')
            if (sourceTransl.text.join('\n') !== msgStr) {
                sourceTransl.text = msgInfo.msgStr
            }
            toTranslate.push(item)
        }
        if (this.#aiQueue?.ai) {
            this.#aiQueue.add(toTranslate)
            await this.#aiQueue.running
        }
        if (this.cleanTrackedRefs(previousReferences)) {
            updated = true
        }
        if (updated && this.#mode != 'cli') {
            // cli saved at the end
            await this.saveStorageCompile()
        }
        return [hmrKeys, updated]
    }

    transform = async (
        content: string,
        filename: string,
        hmrVersion = -1,
        forServer = false,
    ): Promise<[TransformOutputCode, boolean]> => {
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
        let updated = false
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
            const [hmrKeys, updatedItems] = await this.handleMessages(msgs, filename)
            updated = updatedItems
            if (msgs.length && hmrVersion >= 0) {
                hmrData = { version: hmrVersion, data: {} }
                for (const loc of this.#config.locales) {
                    hmrData.data[loc] =
                        hmrKeys.map(key => {
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
        return [output, updated]
    }
}
