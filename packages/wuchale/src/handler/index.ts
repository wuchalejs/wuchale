import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import pm, { type Matcher } from 'picomatch'
import { varNames } from '../adapter-utils/index.js'
import type { Adapter, RuntimeExpr, TransformOutputCode } from '../adapters.js'
import { getKey } from '../adapters.js'
import AIQueue from '../ai/index.js'
import { type CompiledElement, compileTranslation } from '../compile.js'
import type { ConfigPartial, DevMode } from '../config.js'
import type { HMRData } from '../dev.js'
import { readOnlyFS } from '../fs.js'
import type { Logger } from '../log.js'
import { type FileRef, type FileRefEntry, type Item, itemIsUrl, newItem } from '../storage.js'
import type { Text } from '../text.js'
import {
    defaultLoadID,
    Files,
    type FilesOptsCreatePass,
    globConfToArgs,
    type ManifestEntry,
    normalizeSep,
    objKeyLocale,
} from './files.js'
import { type SharedState, State, type WriteProxies } from './state.js'
import { URLHandler } from './url.js'

const loaderImportGetRuntime = 'getRuntime'
const loaderImportGetRuntimeRx = 'getRuntimeRx'

const getFuncPlainDefault = '_w_load_'
const urlLocalizeUdfName = 'localize'
const getFuncReactiveDefault = `${getFuncPlainDefault}rx_`
const bundleCatalogsVarName = '_w_catalogs_'
const updatedFuncName = '_w_updated_'

export type Mode = 'dev' | 'build' | 'cli'

type TrackedRefs = Map<
    string,
    {
        ref: FileRef
        used: number
    }
>

export const newItemsAllowed = (mode: Mode, devMode: DevMode) =>
    mode !== 'dev' || devMode === 'add' || devMode === 'refs' || devMode === 'clean'

function getFallback(
    fbConf: Record<string, string>,
    loc: string,
    sourceLocale: string,
    locales: string[],
    chain: string[],
) {
    let fallback = fbConf[loc]
    if (!fallback) {
        if (loc.includes('-')) {
            fallback = new Intl.Locale(loc).language
        }
        if (!fallback || !locales.includes(fallback)) {
            chain.push(sourceLocale)
            return
        }
    }
    chain.push(fallback)
    getFallback(fbConf, fallback, sourceLocale, locales, chain)
}

export function getFallbackChains(fallbackConf: Record<string, string>, locales: string[], sourceLocale: string) {
    const chains = new Map<string, string[]>([[sourceLocale, [sourceLocale]]])
    for (const loc of locales) {
        if (loc === sourceLocale) {
            continue
        }
        const chain: string[] = [loc]
        chains.set(loc, chain)
        getFallback(fallbackConf, loc, sourceLocale, locales, chain)
    }
    return chains
}

type HandlerOptsCreate = FilesOptsCreatePass & {
    config: ConfigPartial
    primary: boolean
    mode: Mode
    log: Logger
    sourceLocale: string
    sharedState: SharedState
    devMode: DevMode
    modifyInplace: boolean
}

type HandlerOpts = HandlerOptsCreate & {
    granularState: State
    files: Files
}

export class AdapterHandler {
    readonly key: string
    #opts: HandlerOpts
    readonly sourceLocale: string
    readonly adapter: Adapter
    readonly sharedState: SharedState
    readonly granularState: State
    readonly fileMatches: Matcher
    readonly files: Files
    readonly url: URLHandler
    readonly aiQueue?: AIQueue
    onBeforeSave?: () => void
    onWriteCompiled?: (file: string) => void
    #fallbackChains: Map<string, string[]>
    #newKeys = new Set<string>() // keys added during dev

    private constructor(opts: HandlerOpts) {
        this.#opts = opts
        this.key = opts.key
        this.adapter = opts.adapter
        this.granularState = opts.granularState
        this.sharedState = opts.sharedState
        const [patterns, ignore] = globConfToArgs(opts.adapter.files, opts.config.localesDir)
        this.fileMatches = pm(patterns, { ignore })
        this.sourceLocale = opts.sourceLocale
        this.url = new URLHandler(opts.config.locales, this.sourceLocale, opts.adapter.url)
        this.#fallbackChains = getFallbackChains(opts.config.fallback, opts.config.locales, this.sourceLocale)
        this.files = opts.files
        if (opts.config.ai) {
            this.aiQueue = new AIQueue(
                opts.sourceLocale,
                opts.config.ai,
                opts.mode === 'cli' ? this.saveStorage : this.saveStorageCompile,
                opts.log,
            )
        }
    }

    static create = async (opts: HandlerOptsCreate) => {
        const { adapter, key, sharedState, config, primary, fs, root } = opts
        const files = await Files.create({
            adapter,
            key,
            ownerKey: sharedState.ownerKey,
            localesDirAbs: resolve(root, config.localesDir),
            fs: primary ? fs : readOnlyFS,
            root,
        })
        const writeProxies: WriteProxies = groupPatts => files.writeProxies(config.locales, groupPatts)
        const granularState = new State(writeProxies, adapter.loading.group)
        const handler = new AdapterHandler({ ...opts, granularState, files })
        await handler.loadStorage()
        if (await handler.url.initPatterns(key, sharedState.catalog, handler.#fallbackChains, handler.aiQueue)) {
            await handler.saveStorage()
        }
        await handler.compile(-1)
        await writeProxies(granularState.groupPatterns)
        await files.writeUrlFiles(handler.url.buildManifest(), config.locales[0])
        return handler
    }

    loadStorage = async () => {
        if (this.sharedState.ownerKey === this.key) {
            await this.sharedState.load(this.#opts.config.locales)
        }
    }

    saveStorage = async () => {
        this.onBeforeSave?.()
        await this.sharedState.save(this.#opts.mode === 'dev' && this.#opts.devMode === 'clean')
    }

    compile = async (hmrVersion: number) => {
        // for proper fallback
        const localesOrdered = [this.sourceLocale, ...this.#opts.config.locales.filter(l => l !== this.sourceLocale)]
        await Promise.all(localesOrdered.map(loc => this.#compileForLocale(loc, hmrVersion)))
        await this.#writeManifests()
    }

    #buildManifest = (indices: Iterable<[string, number]>): ManifestEntry[] => {
        const manifest: ManifestEntry[] = []
        for (const [key, index] of indices) {
            const item = this.sharedState.catalog.get(key)
            if (item === undefined) {
                manifest[index] = { text: key, isUrl: true }
                continue
            }

            const isUrl = itemIsUrl(item)
            const id = item.translations.get(this.sourceLocale)!
            const text = id.length === 1 ? id[0]! : id
            if (!isUrl && item.context == null) {
                manifest[index] = text
                continue
            }

            manifest[index] = {
                text,
                context: item.context,
                isUrl: isUrl || undefined,
            }
        }
        return manifest
    }

    #writeManifests = async () => {
        const promises = [this.files.writeManifest(this.#buildManifest(this.sharedState.indexTracker.getAll()), null)]
        if (this.adapter.loading.granular) {
            for (const state of this.granularState.byID.values()) {
                promises.push(this.files.writeManifest(this.#buildManifest(state.indexTracker.getAll()), state.id))
            }
        }
        await Promise.all(promises)
    }

    saveStorageCompile = async (hmrVersion = -1) => {
        await this.saveStorage()
        await this.compile(hmrVersion)
    }

    writeCompiled = async (loc: string, hmrVersion: number) => {
        let compiledData = this.sharedState.compiled.get(loc)!
        const pluralRule = this.sharedState.pluralRules.get(loc)!.plural
        const promises = [
            this.files.writeCatalogModule(
                compiledData.items,
                compiledData.hasPlurals ? pluralRule : null,
                loc,
                null,
                hmrVersion,
            ),
        ]
        if (this.adapter.loading.granular) {
            for (const state of this.granularState.byID.values()) {
                compiledData = state.compiled?.get(loc) || {
                    hasPlurals: false,
                    items: [],
                }
                promises.push(
                    this.files.writeCatalogModule(
                        compiledData.items,
                        compiledData.hasPlurals ? pluralRule : null,
                        loc,
                        state.id,
                        hmrVersion,
                    ),
                )
            }
        }
        for (const file of await Promise.all(promises)) {
            this.onWriteCompiled?.(file)
        }
    }

    getCompiledFallback(index: number, locale: string) {
        for (const loc of this.#fallbackChains.get(locale) ?? [locale, this.sourceLocale]) {
            const compiled = this.sharedState.compiled.get(loc)!.items![index]
            if (compiled || loc === this.sourceLocale) {
                return compiled || ''
            }
        }
        return ''
    }

    #compileForLocale = async (loc: string, hmrVersion: number) => {
        let sharedCompiledLoc = this.sharedState.compiled.get(loc)
        if (sharedCompiledLoc == null) {
            sharedCompiledLoc = { hasPlurals: false, items: [] }
            this.sharedState.compiled.set(loc, sharedCompiledLoc)
        }
        for (const [itemKey, item] of this.sharedState.catalog) {
            // compile only if it came from a file under this adapter
            // for urls, skip if not referenced in links
            // in dev mode, include obsolete items, they may be added back
            if (
                (this.#opts.mode !== 'dev' || item.references.length > 0) &&
                !item.references.some(r => this.fileMatches(r.file))
            ) {
                continue
            }
            let keys = [itemKey]
            if (itemIsUrl(item)) {
                keys = []
                const id = item.translations.get(this.sourceLocale)!
                for (const reference of item.references) {
                    for (const ref of reference.refs) {
                        keys.push(ref?.link ?? id[0]!)
                    }
                }
            }
            for (const key of keys) {
                const index = this.sharedState.indexTracker.get(key)
                let compiled: CompiledElement
                const fallback = this.getCompiledFallback(index, loc)
                const transl = item.translations.get(loc)!
                if (transl.length > 1) {
                    sharedCompiledLoc.hasPlurals = true
                    if (transl.join('').trim()) {
                        compiled = transl
                    } else {
                        compiled = fallback
                    }
                } else {
                    let toCompile = transl[0]!
                    if (itemIsUrl(item)) {
                        toCompile = this.url.matchToCompile(key, loc)
                    }
                    compiled = compileTranslation(toCompile, fallback)
                }
                sharedCompiledLoc.items[index] = compiled
                if (!this.adapter.loading.granular) {
                    continue
                }
                for (const ref of item.references) {
                    const state = await this.granularState.byFileCreate(
                        ref.file,
                        this.#opts.config.locales,
                        newItemsAllowed(this.#opts.mode, this.#opts.devMode),
                    )
                    const compiledLoc = state.compiled.get(loc)!
                    compiledLoc.hasPlurals = sharedCompiledLoc.hasPlurals
                    compiledLoc.items[state.indexTracker.get(key)] = compiled
                }
            }
        }
        await this.writeCompiled(loc, hmrVersion)
    }

    #getRuntimeVars = (): RuntimeExpr => ({
        plain: this.adapter.getRuntimeVars?.plain ?? getFuncPlainDefault,
        reactive: this.adapter.getRuntimeVars?.reactive ?? getFuncReactiveDefault,
    })

    #prepareHeader = (
        filename: string,
        loadID: number,
        hmrData: HMRData | null,
        hmrVersion: number,
        hasUrls: boolean,
        forServer: boolean,
    ): string => {
        let head: string[] = []
        if (hasUrls) {
            const localize = this.adapter.url?.localize
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
            getRuntimePlain += 'hmr_'
            getRuntimeReactive += 'hmr_'
            const hmrDataStr = JSON.stringify(hmrData).replaceAll('</script>', '\\x3C/script>')
            head.push(
                `import {updated as ${updatedFuncName}} from "wuchale/dev"`,
                `const [${getRuntimeVars.plain}, ${getRuntimeVars.reactive}] = ${updatedFuncName}(${getRuntimePlain}, ${getRuntimeReactive}, ${hmrDataStr}, ${hmrVersion})`,
            )
        }
        const loaderPath = this.files.getImportLoaderPath(forServer, filename)
        const importsFuncs = [
            `${loaderImportGetRuntime} as ${getRuntimePlain}`,
            `${loaderImportGetRuntimeRx} as ${getRuntimeReactive}`,
        ]
        head = [`import {${importsFuncs.join(', ')}} from "${loaderPath}"`, ...head]
        if (!this.adapter.loading.direct) {
            return head.join('\n')
        }
        const imports: string[] = []
        const objElms: string[] = []
        for (const [i, loc] of this.#opts.config.locales.entries()) {
            const locKW = `_w_c_${i}_`
            const importFrom = this.files.getImportPath(this.files.getCompiledFilePath(loc, loadID), filename)
            imports.push(`import * as ${locKW} from '${importFrom}'`)
            objElms.push(`${objKeyLocale(loc)}: ${locKW}`)
        }
        return [...imports, ...head, `const ${bundleCatalogsVarName} = {${objElms.join(',')}}`].join('\n')
    }

    #prepareRuntimeExpr = (loadID: number): RuntimeExpr => {
        const importLoaderVars = this.#getRuntimeVars()
        if (this.adapter.loading.direct) {
            return {
                plain: `${importLoaderVars.plain}(${bundleCatalogsVarName})`,
                reactive: `${importLoaderVars.reactive}(${bundleCatalogsVarName})`,
            }
        }
        // default is always 0 unless loading.granular is true
        const loadIDParam = loadID === 0 ? '' : loadID
        return {
            plain: `${importLoaderVars.plain}(${loadIDParam})`,
            reactive: `${importLoaderVars.reactive}(${loadIDParam})`,
        }
    }

    popTrackedRefs = (filename: string) => {
        const previousReferences: TrackedRefs = new Map()
        for (const item of this.sharedState.catalog.values()) {
            const existingRef = item.references.find(r => r.file === filename)
            if (!existingRef) {
                continue
            }
            const id = item.translations.get(this.sourceLocale)!
            previousReferences.set(getKey(id, item.context), { ref: existingRef, used: 0 })
        }
        return previousReferences
    }

    updateRef = (item: Item, key: string, filename: string, txt: Text, trackedRefrences: TrackedRefs) => {
        let updated = false
        const newRef: FileRefEntry = {
            placeholders: txt.placeholders.map(([i, p]) => [i, p.replace(/\s+/g, ' ').trim()]),
        }
        if (txt.type === 'url' && getKey(txt.body, txt.context) !== key) {
            newRef.link = txt.body[0]!
        }
        const newRefEntry = newRef.link || txt.placeholders.length ? newRef : null
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
        let cleanedUrls = false
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
            cleanedUrls ||= itemIsUrl(item)
            // after this, it can be marked obsolete and cleaned by cli
        }
        return { cleaned, cleanedUrls }
    }

    handleTexts = async (txts: Text[], filename: string, hmrVersion: number): Promise<[string[], boolean]> => {
        const previousReferences = this.popTrackedRefs(filename)
        let storageUpdated = false
        let compileUpdated = false
        const hmrKeys: string[] = []
        const toTranslate: Item[] = []
        const modifyExistingRefs =
            this.#opts.mode !== 'dev' || this.#opts.devMode === 'refs' || this.#opts.devMode === 'clean'
        for (const txt of txts) {
            let key = getKey(txt.body, txt.context)
            if (txt.type === 'url') {
                const matched = this.url.match(key)
                if (!matched) {
                    const err = new Error(`URL ${txt.body[0]} has no matching pattern defined`)
                    ;(err as any).id = filename
                    throw err
                }
                key = getKey([this.url.patterns[matched[0]]!])
            }
            let item = this.sharedState.catalog.get(key)
            if (!item) {
                item = newItem({ id: txt.body }, this.#opts.config.locales)
                this.sharedState.catalog.set(key, item)
                this.#newKeys.add(key)
                storageUpdated = true
                compileUpdated = true
            }
            if (hmrVersion >= 0 && this.#newKeys.has(key)) {
                hmrKeys.push(key)
            }
            const modifyRefs = modifyExistingRefs || (this.#opts.devMode === 'add' && this.#newKeys.has(key))
            if (modifyRefs && this.updateRef(item, key, filename, txt, previousReferences)) {
                storageUpdated = true
                if (txt.type === 'url') {
                    compileUpdated = true
                }
            }
            if (txt.type === 'url') {
                // already translated or attempted at startup
                // and context not to be updated
                continue
            }
            // biome-ignore lint: noDoubleEquals: NOT !== because they may be null (from pofile!)
            if (txt.context != item.context) {
                storageUpdated = true
                compileUpdated = true
            }
            item.context = txt.context
            const sourceTransl = item.translations.get(this.sourceLocale)!
            const body = txt.body.join('\n')
            if (sourceTransl.join('\n') !== body) {
                item.translations.set(this.sourceLocale, txt.body)
                storageUpdated = true
                compileUpdated = true
            }
            toTranslate.push(item)
        }
        if (this.aiQueue) {
            this.aiQueue.add(toTranslate)
            await this.aiQueue.running
        }
        if (modifyExistingRefs) {
            const { cleaned, cleanedUrls } = this.cleanTrackedRefs(previousReferences)
            if (cleaned) {
                storageUpdated = true
            }
            if (cleanedUrls) {
                compileUpdated = true
            }
        }
        // cli saves and compiles at the end
        if (storageUpdated && this.#opts.mode !== 'cli') {
            this.#opts.devMode && (await this.saveStorage())
            if (compileUpdated) {
                await this.compile(hmrVersion)
            }
        }
        return [hmrKeys, storageUpdated]
    }

    transform = async (
        content: string,
        filename: string,
        hmrVersion = -1,
        forServer = false,
    ): Promise<[TransformOutputCode, boolean]> => {
        filename = normalizeSep(filename)
        let indexTracker = this.sharedState.indexTracker
        let loadID = defaultLoadID
        let compiled = this.sharedState.compiled
        if (this.adapter.loading.granular) {
            const state = await this.granularState.byFileCreate(
                filename,
                this.#opts.config.locales,
                newItemsAllowed(this.#opts.mode, this.#opts.devMode),
            )
            indexTracker = state.indexTracker
            loadID = state.id
            compiled = state.compiled
        }
        const { txts, ...result } = await this.adapter.transform({
            content,
            filename,
            index: indexTracker,
            expr: this.#prepareRuntimeExpr(loadID),
            matchUrl: this.url.match,
        })
        let hmrData: HMRData | null = null
        let updated = false
        if (this.#opts.mode !== 'build') {
            if (this.#opts.log.checkLevel('verbose')) {
                if (txts.length) {
                    this.#opts.log.verbose(`${this.key}: ${txts.length} items from ${filename}:`)
                    for (const txt of txts) {
                        this.#opts.log.verbose(`  ${txt.body.join(', ')} [${txt.path.at(-1)!.type}]`)
                    }
                } else {
                    this.#opts.log.verbose(`${this.key}: No items from ${filename}.`)
                }
            }
            const [hmrKeys, updatedItems] = await this.handleTexts(txts, filename, hmrVersion)
            updated = updatedItems
            if (!forServer && hmrKeys.length > 0) {
                hmrData = {}
                for (const loc of this.#opts.config.locales) {
                    hmrData[loc] =
                        hmrKeys.map(key => {
                            const index = indexTracker.get(key)
                            return [index, compiled.get(loc)!.items[index]!]
                        }) ?? []
                }
            }
        }
        let output: TransformOutputCode = {}
        if (txts.length) {
            output = result.output(
                this.#prepareHeader(
                    filename,
                    loadID,
                    hmrData,
                    hmrVersion,
                    txts.some(m => m.type === 'url'),
                    forServer,
                ),
            )
        }
        if (this.#opts.modifyInplace && output.code) {
            await writeFile(filename, output.code)
        }
        return [output, updated]
    }
}
