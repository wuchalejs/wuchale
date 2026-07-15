/**
 * This is the common coordination logic for use in the CLI as well as the bundler plugins
 */

import { unlinkSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { watch as watchFS } from 'chokidar'
import { glob } from 'tinyglobby'
import { loaderPathResolver } from './adapter-utils/index.js'
import type { Adapter, LoaderPath, TransformOutputCode } from './adapters.js'
import { compileTranslation } from './compile.js'
import type { Config } from './config.js'
import { defaultFS, type FS } from './fs.js'
import {
    dataFileName,
    defaultLoadID,
    generatedDir,
    getLoaderPath,
    globConfToArgs,
    normalizeSep,
} from './handler/files.js'
import { AdapterHandler, type Mode, newItemsAllowed } from './handler/index.js'
import { SharedState } from './handler/state.js'
import { color, Logger } from './log.js'
import { itemIsObsolete, itemIsUrl } from './storage.js'
import { isEquivalent, pluralForms } from './validate.js'

export const pluginName = 'wuchale'
const confUpdateName = 'confUpdate.json'
const pluralFileName = 'plural.js'
export const pluralTemplPath = loaderPathResolver(import.meta.url, '../src', 'js')('plural-tmpl')
const pluralCategOrder: Intl.LDMLPluralRule[] = ['zero', 'one', 'two', 'few', 'many', 'other']
export const devPidFile = 'dev.pid'
const logPrefix = `${color.magenta(`[${pluginName}]`)}:`
const logPrefixHandler = (key: string) => `${color.magenta(key)}:`

type ConfUpdate = Pick<Config, 'dev'>

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

type CheckErrorItem = {
    adapter: string
    source: string[]
    locale: string
    translation: string[]
}

type CheckResult = {
    checked: number
    errors: CheckErrorItem[]
    syncs: string[]
}

type TransformErrFormatter = (e: Error, adapterKey: string, filename: string) => Error

async function initGenDirWithData(config: Config, fs: FS, root: string) {
    const localesDirAbs = resolve(root, config.localesDir)
    await fs.mkdir(resolve(localesDirAbs, generatedDir))
    // data file
    await fs.write(
        resolve(localesDirAbs, dataFileName),
        [
            `/** @typedef {('${config.locales.join("'|'")}')} Locale */`,
            `/** @type {[Locale, ...Locale[]]} */`,
            `export const locales = ['${config.locales.join("','")}']`,
        ].join('\n'),
    )
    const pluralTempl = await fs.read(pluralTemplPath)
    if (!pluralTempl) {
        throw new Error('Plural template not found')
    }
    const pluralFileContent = pluralTempl
        .replaceAll('${DATA}', './data.js')
        .replace('ALL_C = []', `ALL_C = ['${pluralCategOrder.join("', '")}']`)
    await fs.write(resolve(localesDirAbs, pluralFileName), pluralFileContent)
}

async function getSharedState(
    sharedStates: Map<string, SharedState>,
    config: Config,
    fs: FS,
    root: string,
    adapter: Adapter,
    key: string,
    sourceLocale: string,
    allowNewItems: boolean,
): Promise<SharedState> {
    const storage = await adapter.storage({
        locales: config.locales,
        root,
        localesDir: config.localesDir,
        sourceLocale: sourceLocale,
        fs,
    })
    let sharedState = sharedStates.get(storage.key)
    if (sharedState == null) {
        sharedState = new SharedState(storage, key, sourceLocale, allowNewItems)
        sharedStates.set(storage.key, sharedState)
    } else {
        if (sharedState.sourceLocale !== sourceLocale) {
            throw new Error(
                `${logPrefix} Adapters with different source locales (${sharedState.ownerKey} and ${key}) cannot share catalogs.`,
            )
        }
    }
    return sharedState
}

async function processIsPrimary(mode: Mode, fs: FS, pidFileAbs: string) {
    const pidStr = await fs.read(pidFileAbs)
    const pid = pidStr ? Number(pidStr) : null
    let primary = pid == null || pid === process.pid
    if (pid != null && pid !== process.pid) {
        try {
            process.kill(pid, 0)
        } catch {
            primary = true
        }
    }
    if (primary && pid !== process.pid && mode === 'dev') {
        await fs.write(pidFileAbs, process.pid.toString())
        const cleanup = () => {
            try {
                unlinkSync(pidFileAbs)
            } catch {}
        }
        const onSignal = (signal: NodeJS.Signals) => {
            cleanup()
            process.off(signal, onSignal)
            // not to affect other listeners
            process.kill(process.pid, signal)
        }
        process.on('SIGTERM', onSignal)
        process.on('SIGINT', onSignal)
        process.on('SIGHUP', onSignal)
        process.on('exit', cleanup)
    }
    return primary
}

type HubOpts = {
    mode: Mode
    config: Config
    root: string
    primary: boolean
    log: Logger
    // threshold to consider po file change is manual edit instead of a sideeffect of editing code
    hmrDelayThreshold: number
    fs: FS
    handlers: Map<string, AdapterHandler>
    confUpdateFileAbs: string
    formatTransformErr: TransformErrFormatter
}

export class Hub {
    #opts: HubOpts

    #handlers: Map<string, AdapterHandler>

    #handlersByCatalogPath: Map<string, AdapterHandler[]> = new Map()
    #compiledCatalogs: Set<string> = new Set()

    #formatTransformErr: TransformErrFormatter = e => e

    #hmrVersion = -1
    #lastSourceTriggeredCatalogWrite: number = 0

    #lastAdapterForFile = new Map<string, string>()

    private constructor(opts: HubOpts) {
        this.#opts = opts
        this.#handlers = opts.handlers
        const handlersByLoaderPath: Map<string, AdapterHandler> = new Map()
        for (const [key, handler] of opts.handlers) {
            handler.onBeforeSave = () => {
                this.#lastSourceTriggeredCatalogWrite = performance.now()
            }
            handler.onWriteCompiled = file => {
                this.#compiledCatalogs.add(file)
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
    }

    static create = async (
        mode: Mode,
        loadConfig: ConfigLoader,
        root: string,
        modifyAdapters: string[] = [],
        hmrDelayThreshold = 1000,
        fs = defaultFS,
        formatTransformErr: TransformErrFormatter = e => e,
    ) => {
        const config = await loadConfig()
        const adaptersData = Object.entries(config.adapters)
        if (adaptersData.length === 0) {
            throw Error(`${logPrefix} at least one adapter is needed.`)
        }
        const log = new Logger(config.logLevel)
        const pidFileAbs = resolve(root, config.localesDir, generatedDir, devPidFile)
        const primary = await processIsPrimary(mode, fs, pidFileAbs)
        if (!primary) {
            log.warn(logPrefix, 'running in secondary process')
        }
        await initGenDirWithData(config, fs, root)
        const sharedStates = new Map<string, SharedState>()
        const handlers = new Map<string, AdapterHandler>()
        const commonOpts = { config, mode, fs, root, log }
        for (const [key, adapter] of adaptersData) {
            const sourceLocale = adapter.sourceLocale ?? config.locales[0]
            const handler = await AdapterHandler.create({
                ...commonOpts,
                primary,
                adapter,
                key,
                sourceLocale,
                sharedState: await getSharedState(
                    sharedStates,
                    config,
                    fs,
                    root,
                    adapter,
                    key,
                    sourceLocale,
                    newItemsAllowed(mode, config.dev),
                ),
                devMode: config.dev,
                modifyInplace: modifyAdapters.includes(key),
            })
            handlers.set(key, handler)
        }
        const confUpdateFileAbs = resolve(root, config.localesDir, generatedDir, confUpdateName)
        if (mode === 'dev' && primary) {
            await fs.write(confUpdateFileAbs, '{}') // only watch changes so prepare first
        }
        return new Hub({
            ...commonOpts,
            primary,
            handlers,
            confUpdateFileAbs: normalizeSep(confUpdateFileAbs),
            hmrDelayThreshold,
            formatTransformErr,
        })
    }

    onFileChange = async (file: string, read: () => string | Promise<string>): Promise<FileChangeInfo | undefined> => {
        file = normalizeSep(file) // just to be sure
        if (this.#opts.confUpdateFileAbs === file && this.#opts.primary) {
            const updateTxt = await read()
            const update: Partial<ConfUpdate> = JSON.parse(updateTxt)
            this.#opts.log.info(logPrefix, 'config update received:', color.cyan(updateTxt))
            if (update.dev !== undefined) {
                this.#opts.config.dev = update.dev
            }
            return ignoreChange
        }
        if (!this.#opts.config.dev) {
            return
        }
        // This is mainly to make sure that catalog file changes result in a page reload with new catalogs
        const handlers = this.#handlersByCatalogPath.get(file)
        if (handlers == null) {
            // prevent reloading whole app because of a change in compiled catalog
            // triggered by extraction from single file, hmr handled by embedding patch
            if (this.#compiledCatalogs.has(file)) {
                return ignoreChange
            }
            this.#hmrVersion++
            return
        }
        // catalog changed
        const changeInfo: FileChangeInfo = {
            sourceTriggered: performance.now() - this.#lastSourceTriggeredCatalogWrite < this.#opts.hmrDelayThreshold,
            invalidate: new Set(),
        }
        for (const handler of handlers) {
            if (!changeInfo.sourceTriggered) {
                await handler.loadStorage()
                await handler.compile(this.#hmrVersion)
            }
            const loadIDs = [defaultLoadID]
            for (const state of handler.granularState.byID.values()) {
                // only the ones with ready items
                if (state.compiled.get(handler.sourceLocale)!.length) {
                    loadIDs.push(state.id)
                }
            }
            for (const loc of this.#opts.config.locales) {
                for (const loadID of loadIDs) {
                    changeInfo.invalidate.add(normalizeSep(handler.files.getCompiledFilePath(loc, loadID)))
                }
            }
        }
        return changeInfo
    }

    transform = async (code: string, filePath: string, forServer = false): ReturnType<AdapterHandler['transform']> => {
        if (this.#opts.mode === 'dev' && !this.#opts.config.dev) {
            return [{}, false]
        }
        const filename = normalizeSep(relative(this.#opts.root, filePath))
        let output: [TransformOutputCode, boolean] | null = null
        for (const adapter of this.#handlers.values()) {
            if (!adapter.fileMatches(filename)) {
                continue
            }
            try {
                output = await adapter.transform(code, filename, this.#hmrVersion, forServer)
            } catch (e) {
                throw this.#formatTransformErr(e as Error, adapter.key, filename)
            }
            break
        }
        return output ?? [{}, false]
    }

    #visitFileHandl = async (filename: string, handler: AdapterHandler) => {
        const lastAdapterKey = this.#lastAdapterForFile.get(filename)
        if (lastAdapterKey && lastAdapterKey !== handler.key) {
            this.#opts.log.warn(
                color.cyan(filename),
                'matches both adapters',
                color.magenta(lastAdapterKey),
                'and',
                color.magenta(handler.key),
            )
        }
        this.#lastAdapterForFile.set(filename, handler.key)
        this.#opts.log.info(logPrefixHandler(handler.key), 'Extract from', color.cyan(filename))
        const contents = await this.#opts.fs.read(resolve(this.#opts.root, filename))
        const [, updated] = await handler.transform(contents!, filename)
        return updated
    }

    async #directVisitHandler(
        handler: AdapterHandler,
        clean: boolean,
        sync: boolean,
        existingFilesByOwner: Map<string, Set<string>>,
    ): Promise<boolean> {
        const [patterns, ignore] = globConfToArgs(handler.adapter.files, this.#opts.config.localesDir)
        const filePaths = await glob(patterns, { ignore, cwd: this.#opts.root })
        let existingFiles = existingFilesByOwner.get(handler.sharedState.ownerKey)
        if (existingFiles) {
            for (const file of filePaths) {
                existingFiles.add(file)
            }
        } else {
            existingFiles = new Set(filePaths)
            existingFilesByOwner.set(handler.sharedState.ownerKey, existingFiles)
        }
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
        if (handler.sharedState.ownerKey === handler.key) {
            let cleaned = 0
            for (const [key, item] of catalog) {
                const initRefsN = item.references.length
                // check if file deleted or pattern no longer matches
                item.references = item.references.filter(ref => existingFiles.has(ref.file))
                if (item.references.length < initRefsN) {
                    updated = true
                }
                if (!clean || !itemIsObsolete(item)) {
                    continue
                }
                catalog.delete(key)
                updated = true
                cleaned++
            }
            if (cleaned > 0) {
                this.#opts.log.info(logPrefixHandler(handler.key), 'Cleaned', color.cyan(cleaned), 'items')
            }
        }
        if (updated) {
            await handler.saveStorage()
            await handler.compile(this.#hmrVersion)
        }
        return updated
    }

    #getSortedHandlersForDirectVisit = () => {
        const handlers = [...this.#handlers.values()]
        // owner adapter handlers should run last for cleanup
        handlers.sort((a, b) => {
            const aOwner = a.sharedState.ownerKey === a.key
            const bOwner = b.sharedState.ownerKey === b.key
            return aOwner === bOwner ? 0 : aOwner ? 1 : -1
        })
        return handlers
    }

    async directVisit(clean: boolean, watch: boolean, sync: boolean) {
        !watch && this.#opts.log.info('Extracting...')
        const existingFilesByOwner = new Map<string, Set<string>>()
        for (const handler of this.#getSortedHandlersForDirectVisit()) {
            await this.#directVisitHandler(handler, clean, sync, existingFilesByOwner)
        }
        if (!watch) {
            this.#opts.log.info('Extraction finished.')
            return
        }
        // watch
        this.#opts.log.info('Watching for changes')
        watchFS('.', { ignoreInitial: true }).on('all', async (event, filename) => {
            if (!['add', 'change'].includes(event)) {
                return
            }
            const id = resolve(this.#opts.root, filename)
            const read = async () => (await this.#opts.fs.read(id))!
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
                loaders: await getLoaderPath(
                    handler.adapter,
                    handler.key,
                    resolve(this.#opts.root, this.#opts.config.localesDir),
                    this.#opts.root,
                    this.#opts.fs,
                ),
                storage: state.ownerKey === key ? adapStats : { own: false, ownerKey: state.ownerKey },
            })
            if (state.ownerKey !== key) {
                continue
            }
            await state.load(this.#opts.config.locales)
            adapStats.total = state.catalog.size
            adapStats.url = Array.from(state.catalog.values()).filter(i => itemIsUrl(i)).length
            for (const locale of this.#opts.config.locales) {
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
        const existingFilesByOwner = new Map<string, Set<string>>()
        const plurals = new Map(this.#opts.config.locales.map(l => [l, pluralForms(l).length]))
        for (const handler of this.#getSortedHandlersForDirectVisit()) {
            const state = handler.sharedState
            if (full && (await this.#directVisitHandler(handler, false, false, existingFilesByOwner))) {
                syncs.push(handler.key)
            }
            if (state.ownerKey !== handler.key) {
                continue
            }
            const otherLocales = this.#opts.config.locales
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
                    }
                    if (translation.length === 0) {
                        continue
                    }
                    const translComp = translation.map(t => compileTranslation(t, ''))
                    if (!isEquivalent(sourceCompEntries, translComp, plurals.get(locale) ?? 0)) {
                        errors.push(err)
                        break
                    }
                }
            }
        }
        return { checked: checkedItems, errors, syncs }
    }
}
