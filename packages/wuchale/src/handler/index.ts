import { isAbsolute, join, normalize, resolve } from 'node:path'
import pm, { type Matcher } from 'picomatch'
import PO from 'pofile'
import { varNames } from '../adapter-utils/index.js'
import type { Adapter, CatalogExpr, HMRData } from '../adapters.js'
import { Message } from '../adapters.js'
import AIQueue from '../ai/index.js'
import { type CompiledElement, compileTranslation } from '../compile.js'
import { type ConfigPartial, getLanguageName } from '../config.js'
import { type Logger } from '../log.js'
import { Files, globConfToArgs, normalizeSep, objKeyLocale } from './files.js'
import { type Catalog, defaultPluralRule, type ItemType, loadCatalogFromPO, POFile, saveCatalogToPO } from './pofile.js'
import { type SharedState, SharedStates, State } from './state.js'
import { URLHandler, urlPatternFlag } from './url.js'

const loaderImportGetRuntime = 'getRuntime'
const loaderImportGetRuntimeRx = 'getRuntimeRx'

const getFuncPlainDefault = '_w_load_'
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

    #catalogsFname: Map<string, string> = new Map()
    catalogPathsToLocales: Map<string, string> = new Map()

    // sub handlers
    files: Files
    url: URLHandler

    #mode: Mode
    #aiQueues: Map<string, AIQueue> = new Map()

    #log: Logger

    onBeforeWritePO: () => void

    constructor(adapter: Adapter, key: string, config: ConfigPartial, mode: Mode, projectRoot: string, log: Logger) {
        this.#adapter = adapter
        this.url = new URLHandler(adapter.url)
        this.key = key
        this.#mode = mode
        this.#projectRoot = projectRoot
        this.#config = config
        this.#log = log
        this.fileMatches = pm(...globConfToArgs(this.#adapter.files, this.#adapter.localesDir, this.#adapter.outDir))
        this.allLocales = [...this.#config.locales]
        this.sourceLocale = this.#adapter.sourceLocale ?? this.#config.locales[0]
        if (!this.allLocales.includes(this.sourceLocale)) {
            this.allLocales.push(this.sourceLocale)
        }
    }

    catalogFileName = (locale: string): string => {
        let catalog = join(this.#adapter.localesDir, `${locale}.po`)
        if (!isAbsolute(catalog)) {
            catalog = normalize(`${this.#projectRoot}/${catalog}`)
        }
        return normalizeSep(catalog)
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
        return await this.url.initPatterns(loc, this.sourceLocale, catalog, aiQueue)
    }

    init = async (sharedStates: SharedStates) => {
        const sourceLocaleName = getLanguageName(this.sourceLocale)
        this.sharedState = sharedStates.getAdd(this.#adapter.localesDir, this.key, this.sourceLocale, this.fileMatches)
        this.files = new Files(this.#adapter, this.key, this.sharedState.ownerKey)
        await this.files.init(this.#config.locales, this.sourceLocale)
        const writeProxies = () => this.files.writeProxies(this.#config.locales, ...this.getLoadIDs())
        this.granularState = new State(writeProxies, this.#adapter.generateLoadID)
        const catalogsByLoc = new Map<string, Catalog>()
        for (const loc of this.allLocales) {
            this.#catalogsFname.set(loc, this.catalogFileName(loc))
            // for handleHotUpdate
            this.catalogPathsToLocales.set(this.#catalogsFname.get(loc)!, loc)
            if (loc !== this.sourceLocale && this.#config.ai) {
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
            }
            await this.loadCatalogNCompile(loc)
            const catalog = this.sharedState.poFilesByLoc.get(loc)!.catalog
            if (await this.initUrlPatterns(loc, catalog)) {
                await this.savePoAndCompile(loc)
            }
            catalogsByLoc.set(loc, catalog)
        }
        await writeProxies()
        await this.files.writeUrlFiles(this.url.buildManifest(catalogsByLoc), this.#config.locales[0])
    }

    loadCatalogNCompile = async (loc: string, hmrVersion = -1) => {
        if (this.sharedState.ownerKey === this.key) {
            const poFile = await loadCatalogFromPO(this.#catalogsFname.get(loc)!, this.key, this.#log)
            if (poFile) {
                this.sharedState.poFilesByLoc.set(loc, poFile)
            }
        }
        await this.compile(loc, hmrVersion)
    }

    writeCompiled = async (loc: string, hmrVersion = -1) => {
        let compiledData = this.sharedState.compiled.get(loc)!
        const pluralRule = this.sharedState.poFilesByLoc.get(loc)!.pluralRule.plural
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

    compile = async (loc: string, hmrVersion = -1) => {
        let sharedCompiledLoc = this.sharedState.compiled.get(loc)
        if (sharedCompiledLoc == null) {
            sharedCompiledLoc = { hasPlurals: false, items: [] }
            this.sharedState.compiled.set(loc, sharedCompiledLoc)
        }
        const sharedCompiledSourceItems = this.sharedState.compiled.get(this.sourceLocale)?.items // ?. for sourceLocale itself
        const catalog = this.sharedState.poFilesByLoc.get(loc)!.catalog
        for (const [itemKey, poItem] of catalog.entries()) {
            // compile only if it came from a file under this adapter
            // for urls, skip if not referenced in links
            if (!poItem.references.some(f => this.fileMatches(f))) {
                continue
            }
            let keys = [itemKey]
            if (poItem.flags[urlPatternFlag]) {
                keys = []
                for (const comment of poItem.extractedComments) {
                    keys.push(comment.split(' ', 1)[0])
                }
            }
            for (const key of keys) {
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
                    if (poItem.flags[urlPatternFlag]) {
                        toCompile = this.url.matchToCompile(key, loc, catalog)
                    }
                    compiled = compileTranslation(toCompile, fallback)
                }
                sharedCompiledLoc.items[index] = compiled
                if (!this.#adapter.granularLoad) {
                    continue
                }
                for (const fname of poItem.references) {
                    const state = await this.granularState.byFileCreate(fname, this.allLocales)
                    const compiledLoc = state.compiled.get(loc)!
                    compiledLoc.hasPlurals = sharedCompiledLoc.hasPlurals
                    compiledLoc.items[state.indexTracker.get(key)] = compiled
                }
            }
        }
        await this.writeCompiled(loc, hmrVersion)
    }

    savePO = async (loc: string) => {
        const poFile = this.sharedState.poFilesByLoc.get(loc)!
        poFile.updateHeaders(loc, this.sourceLocale)
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
        let commentsChanged = false
        for (const msgInfo of msgs) {
            let key = msgInfo.toKey()
            hmrKeys.push(key)
            if (msgInfo.type === 'url') {
                key = this.url.patternKeys.get(this.url.match(key)!)! // ! because already checked at extraction
            }
            let poItem = poFile.catalog.get(key)
            if (!poItem) {
                // @ts-expect-error
                poItem = new PO.Item({
                    nplurals: poFile.pluralRule.nplurals,
                })
                poItem.msgid = msgInfo.msgStr[0]
                if (msgInfo.plural) {
                    poItem.msgid_plural = msgInfo.msgStr[1] ?? msgInfo.msgStr[0]
                }
                poFile.catalog.set(key, poItem)
            }
            let newComments = msgInfo.comments.map(c => c.replace(/\s+/g, ' ').trim())
            if (msgInfo.type === 'url') {
                newComments = [`${msgInfo.toKey()} ${newComments.join('; ')}`.trim()]
            } else if (msgInfo.context) {
                poItem.msgctxt = msgInfo.context
            }
            let iStartComm: number
            const prevRef = previousReferences.get(key)
            if (prevRef == null) {
                poItem.references.push(filename)
                poItem.references.sort() // make deterministic
                iStartComm = poItem.references.lastIndexOf(filename) * newComments.length
                newRefs = true // now it references it
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
        if (untranslated.length === 0) {
            if (newRefs || previousReferences.size || commentsChanged) {
                await this.savePoAndCompile(loc)
            }
            return hmrKeys
        }
        if (loc === this.sourceLocale || !this.#aiQueues.get(loc)?.ai) {
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
            output = result.output(this.#prepareHeader(filename, loadID, hmrData, forServer))
        }
        await this.files.writeTransformed(filename, output.code ?? content)
        return output
    }
}
