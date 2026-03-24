/**
 * This is the common coordination logic for use in the CLI as well as the bundler plugins
 */

import { relative, resolve } from 'node:path'
import { watch as watchFS } from 'chokidar'
import { type Matcher } from 'picomatch'
import { glob } from 'tinyglobby'
import type { Adapter, LoaderPath, TransformOutputCode } from './adapters.js'
import { compileTranslation, isEquivalent } from './compile.js'
import type { Config } from './config.js'
import { defaultFS, type FS } from './fs.js'
import { dataFileName, generatedDir, globConfToArgs, normalizeSep } from './handler/files.js'
import { AdapterHandler, type Mode } from './handler/index.js'
import { SharedState } from './handler/state.js'
import { color, Logger } from './log.js'
import { itemIsObsolete, itemIsUrl } from './storage.js'

export const pluginName = 'wuchale'
const confUpdateName = 'confUpdate.json'
const logPrefix = `[${color.magenta(pluginName)}]:`
const logPrefixHandler = (key: string) => `${color.magenta(key)}:`

type ConfUpdate = {
    hmr: boolean
}

type ConfigLoader = () => Config | Promise<Config>

type FileChangeInfo = {
    sourceTriggered: boolean
    invalidate: Set<string>
}

const ignoreChange: FileChangeInfo = {
    sourceTriggered: false,
    invalidate: new Set(),
}

type LocaleStatDetails = {
    locale: string
    untranslated: number
    obsolete: number
}

type TranslStats = {
    own: true
    total: number
    url: number
    details: LocaleStatDetails[]
}

type AdapterStatus = {
    key: string
    loaders?: LoaderPath
    storage:
        | {
              own: false
              ownerKey: string
          }
        | TranslStats
}

export type CheckErrorType = 'notEquivalent' | 'unequalLength'

type CheckErrorItem = {
    adapter: string
    source: string[]
    locale: string
    translation: string[]
    type: CheckErrorType
}

type CheckResult = {
    checked: number
    errors: CheckErrorItem[]
    syncs: string[]
}

type TransformErrFormatter = (e: Error, adapterKey: string, filename: string) => Error

export class Hub {
    #config: Config
    #fs: FS
    #projectRoot: string = ''

    #handlers: Map<string, AdapterHandler> = new Map()
    #sharedStates: Map<string, SharedState> = new Map()

    #confUpdateFile: string
    #handlersByCatalogPath: Map<string, AdapterHandler[]> = new Map()
    #granularLoadHandlers: AdapterHandler[] = []
    #singleCompiledCatalogs: Set<string> = new Set()

    #log: Logger
    #mode: Mode

    #loadConfig: ConfigLoader
    #formatTransformErr: TransformErrFormatter = e => e

    #hmrVersion = -1
    #hmrDelayThreshold: number
    #lastSourceTriggeredCatalogWrite: number = 0

    constructor(
        loadConfig: ConfigLoader,
        root: string,
        hmrDelayThreshold = 1000,
        fs = defaultFS,
        formatTransformErr?: TransformErrFormatter,
    ) {
        this.#loadConfig = loadConfig
        this.#fs = fs
        this.#projectRoot = root
        // threshold to consider po file change is manual edit instead of a sideeffect of editing code
        this.#hmrDelayThreshold = hmrDelayThreshold
        this.#formatTransformErr = formatTransformErr ?? this.#formatTransformErr
    }

    async #initGenDirWithData() {
        const localesDirAbs = resolve(this.#projectRoot, this.#config.localesDir)
        await this.#fs.mkdir(resolve(localesDirAbs, generatedDir))
        // data file
        await this.#fs.write(
            resolve(localesDirAbs, dataFileName),
            [
                `/** @typedef {('${this.#config.locales.join("'|'")}')} Locale */`,
                `/** @type {Locale[]} */`,
                `export const locales = ['${this.#config.locales.join("','")}']`,
            ].join('\n'),
        )
    }

    init = async (mode: Mode) => {
        this.#mode = mode
        this.#config = await this.#loadConfig()
        this.#log = new Logger(this.#config.logLevel)
        const adaptersData = Object.entries(this.#config.adapters)
        if (adaptersData.length === 0) {
            throw Error(`${logPrefix} at least one adapter is needed.`)
        }
        await this.#initGenDirWithData()
        const handlersByLoaderPath: Map<string, AdapterHandler> = new Map()
        for (const [key, adapter] of adaptersData) {
            const handler = new AdapterHandler(
                adapter,
                key,
                this.#config,
                this.#mode,
                this.#fs,
                this.#projectRoot,
                this.#log,
            )
            await handler.init(this.#getSharedState(adapter, key, handler.sourceLocale, handler.fileMatches))
            handler.onBeforeSave = () => {
                this.#lastSourceTriggeredCatalogWrite = performance.now()
            }
            this.#handlers.set(key, handler)
            if (adapter.granularLoad) {
                this.#granularLoadHandlers.push(handler)
            } else {
                for (const locale of this.#config.locales) {
                    this.#singleCompiledCatalogs.add(
                        normalizeSep(resolve(handler.files.getCompiledFilePath(locale, null))),
                    )
                }
            }
            for (const path of Object.values(handler.files.loaderPath)) {
                const loaderPath = normalizeSep(resolve(path))
                if (handlersByLoaderPath.has(loaderPath)) {
                    const otherKey = handlersByLoaderPath.get(loaderPath)?.key
                    if (otherKey === key) {
                        // same loader for both ssr and client, no problem
                        continue
                    }
                    throw new Error(
                        [
                            logPrefix,
                            'While catalogs can be shared, the same loader cannot be used by multiple adapters',
                            `Conflicting: ${key} and ${otherKey}`,
                            'Specify a different loaderPath for one of them.',
                        ].join('\n'),
                    )
                }
                handlersByLoaderPath.set(loaderPath, handler)
            }
            for (const fname of handler.sharedState.storage.files) {
                const normalized = normalizeSep(fname)
                const handlers = this.#handlersByCatalogPath.get(normalized)
                if (handlers) {
                    handlers.push(handler)
                } else {
                    this.#handlersByCatalogPath.set(normalized, [handler])
                }
            }
        }
        const confUpdateFileAbs = resolve(this.#projectRoot, this.#config.localesDir, generatedDir, confUpdateName)
        this.#confUpdateFile = normalizeSep(confUpdateFileAbs)
        await this.#fs.write(this.#confUpdateFile, '{}') // only watch changes so prepare first
    }

    #getSharedState = (adapter: Adapter, key: string, sourceLocale: string, fileMatches: Matcher): SharedState => {
        const storage = adapter.storage({
            locales: this.#config.locales,
            root: this.#projectRoot,
            sourceLocale: sourceLocale,
            haveUrl: adapter.url != null,
            fs: this.#fs,
        })
        let sharedState = this.#sharedStates.get(storage.key)
        if (sharedState == null) {
            sharedState = new SharedState(storage, key, sourceLocale)
            this.#sharedStates.set(storage.key, sharedState)
        } else {
            if (sharedState.sourceLocale !== sourceLocale) {
                throw new Error(
                    `${logPrefix} Adapters with different source locales (${sharedState.ownerKey} and ${key}) cannot share catalogs.`,
                )
            }
            sharedState.otherFileMatches.push(fileMatches)
        }
        return sharedState
    }

    onFileChange = async (file: string, read: () => string | Promise<string>): Promise<FileChangeInfo | undefined> => {
        file = normalizeSep(file) // just to be sure
        if (this.#confUpdateFile === file) {
            const updateTxt = await read()
            const update: ConfUpdate = JSON.parse(updateTxt)
            this.#log.info(`${logPrefix} config update received: ${color.cyan(updateTxt)}`)
            this.#config.hmr = update.hmr
            return ignoreChange
        }
        if (!this.#config.hmr) {
            return
        }
        // This is mainly to make sure that catalog file changes result in a page reload with new catalogs
        const adapters = this.#handlersByCatalogPath.get(file)
        if (adapters == null) {
            // prevent reloading whole app because of a change in compiled catalog
            // triggered by extraction from single file, hmr handled by embedding patch
            if (this.#singleCompiledCatalogs.has(file)) {
                return ignoreChange
            }
            // for granular as well
            for (const adapter of this.#granularLoadHandlers) {
                for (const loc of this.#config.locales) {
                    for (const id of adapter.granularState.byID.keys()) {
                        if (normalizeSep(resolve(adapter.files.getCompiledFilePath(loc, id))) === file) {
                            return ignoreChange
                        }
                    }
                }
            }
            this.#hmrVersion++
            return
        }
        // catalog changed
        const changeInfo: FileChangeInfo = {
            sourceTriggered: performance.now() - this.#lastSourceTriggeredCatalogWrite < this.#hmrDelayThreshold,
            invalidate: new Set(),
        }
        for (const adapter of adapters) {
            for (const loc of this.#config.locales) {
                if (!changeInfo.sourceTriggered) {
                    await adapter.loadStorage()
                    await adapter.compile(this.#hmrVersion)
                }
                for (const loadID of adapter.getLoadIDs()[0]) {
                    changeInfo.invalidate.add(normalizeSep(resolve(adapter.files.getCompiledFilePath(loc, loadID))))
                }
            }
        }
        return changeInfo
    }

    transform = async (code: string, filePath: string, forServer = false): ReturnType<AdapterHandler['transform']> => {
        if (this.#mode === 'dev' && !this.#config.hmr) {
            return [{}, false]
        }
        const filename = normalizeSep(relative(this.#projectRoot, filePath))
        let output: [TransformOutputCode, boolean] | null = null
        let lastAdapterKey: string | null = null
        for (const adapter of this.#handlers.values()) {
            if (adapter.fileMatches(filename)) {
                if (lastAdapterKey != null) {
                    throw new Error(
                        `${logPrefix} ${filename} matches both adapters ${lastAdapterKey} and ${adapter.key}`,
                    )
                }
                try {
                    output = await adapter.transform(code, filename, this.#hmrVersion, forServer)
                } catch (e) {
                    throw this.#formatTransformErr(e, adapter.key, filename)
                }
                lastAdapterKey = adapter.key
            }
        }
        return output ?? [{}, false]
    }

    #visitFileHandl = async (filename: string, handler: AdapterHandler) => {
        this.#log.info(`${logPrefixHandler(handler.key)} Extract from ${color.cyan(filename)}`)
        const contents = await this.#fs.read(resolve(this.#projectRoot, filename))
        const [, updated] = await handler.transform(contents!, filename)
        return updated
    }

    async #directVisitHandler(handler: AdapterHandler, clean: boolean, sync: boolean): Promise<boolean> {
        const filePaths = await glob(
            ...globConfToArgs(
                handler.adapter.files,
                this.#projectRoot,
                this.#config.localesDir,
                handler.adapter.outDir,
            ),
        )
        const catalog = handler.sharedState.catalog
        let updated = false
        if (sync) {
            for (const fPath of filePaths) {
                updated ||= await this.#visitFileHandl(fPath, handler)
            }
        } else {
            updated ||= (await Promise.all(filePaths.map(f => this.#visitFileHandl(f, handler)))).some(r => r)
        }
        // only owner adapter should clean
        if (clean && handler.sharedState.ownerKey === handler.key) {
            const logPrefix = logPrefixHandler(handler.key)
            this.#log.info(`${logPrefix} Cleaning...`)
            let cleaned = 0
            for (const [key, item] of catalog) {
                const initRefsN = item.references.length
                item.references = item.references.filter(
                    ref =>
                        handler.fileMatches(ref.file) ||
                        handler.sharedState.otherFileMatches.some(match => match(ref.file)),
                )
                if (item.references.length < initRefsN) {
                    updated = true
                    cleaned++
                }
                if (itemIsObsolete(item)) {
                    catalog.delete(key)
                    updated = true
                    cleaned++
                }
            }
            if (cleaned) {
                this.#log.info(`${logPrefix} Cleaned ${cleaned} items`)
            }
        }
        if (updated) {
            await handler.saveStorage()
            await handler.compile()
        }
        return updated
    }

    async directVisit(clean: boolean, watch: boolean, sync: boolean) {
        !watch && this.#log.info('Extracting...')
        const handlers = Array.from(this.#handlers.values())
        // owner adapter handlers should run last for cleanup
        handlers.sort((a, b) => {
            const aOwner = a.sharedState.ownerKey === a.key
            const bOwner = b.sharedState.ownerKey === b.key
            return aOwner === bOwner ? 0 : aOwner ? 1 : -1
        })
        // separate loop to make sure that all otherFileMatchers are collected
        for (const handler of handlers) {
            await this.#directVisitHandler(handler, clean, sync)
        }
        if (!watch) {
            this.#log.info('Extraction finished.')
            return
        }
        // watch
        this.#log.info('Watching for changes')
        watchFS('.', { ignoreInitial: true }).on('all', async (event, filename) => {
            if (!['add', 'change'].includes(event)) {
                return
            }
            const id = resolve(this.#projectRoot, filename)
            const read = async () => (await this.#fs.read(id))!
            await this.onFileChange(id, read)
            await this.transform(await read(), id)
        })
    }

    async status(): Promise<AdapterStatus[]> {
        const statuses: AdapterStatus[] = []
        for (const [key, handler] of this.#handlers) {
            const state = handler.sharedState
            const adapStats: TranslStats = { own: true, total: 0, url: 0, details: [] }
            statuses.push({
                key,
                loaders: await handler.files.getLoaderPath(),
                storage: state.ownerKey === key ? adapStats : { own: false, ownerKey: state.ownerKey },
            })
            if (state.ownerKey !== key) {
                continue
            }
            await state.load(this.#config.locales)
            adapStats.total = state.catalog.size
            adapStats.url = Array.from(state.catalog.values()).filter(i => itemIsUrl(i)).length
            for (const locale of this.#config.locales) {
                const stats: LocaleStatDetails = { locale, untranslated: 0, obsolete: 0 }
                for (const item of state.catalog.values()) {
                    if (!item.translations.get(locale)![0]) {
                        stats.untranslated++
                    }
                    if (itemIsObsolete(item)) {
                        stats.obsolete++
                    }
                }
                adapStats.details.push(stats)
            }
        }
        return statuses
    }

    async check(full = false): Promise<CheckResult> {
        const errors: CheckErrorItem[] = []
        const syncs: string[] = []
        let checkedItems = 0
        for (const handler of this.#handlers.values()) {
            const state = handler.sharedState
            if (full && (await this.#directVisitHandler(handler, true, false))) {
                syncs.push(handler.key)
            }
            if (state.ownerKey !== handler.key) {
                continue
            }
            const otherLocales = this.#config.locales
            for (const item of state.catalog.values()) {
                checkedItems++
                const source = item.translations.get(handler.sourceLocale)!
                const sourceCompEntries = source.map(i => compileTranslation(i, ''))
                for (const locale of otherLocales) {
                    const translation = item.translations.get(locale)!
                    const err: CheckErrorItem = {
                        adapter: handler.key,
                        source,
                        translation: translation ?? [],
                        locale,
                        type: 'unequalLength',
                    }
                    if (translation.length === 0) {
                        continue
                    }
                    if (translation.length > 0 && translation.length !== source.length) {
                        errors.push(err)
                        continue
                    }
                    for (const [i, sou] of sourceCompEntries.entries()) {
                        if (!isEquivalent(sou, compileTranslation(translation[i], ''))) {
                            err.type = 'notEquivalent'
                            errors.push(err)
                            break
                        }
                    }
                }
            }
        }
        return { checked: checkedItems, errors, syncs }
    }
}
