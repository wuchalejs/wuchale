// $$ cd ../.. && npm run test
import { writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { inspect } from 'node:util'
import { AdapterHandler, type Config, getConfig, Logger, type Mode, normalizeSep, SharedStates } from 'wuchale'

const pluginName = 'wuchale'
const confUpdateName = 'confUpdate.json'

type HotUpdateCtx = {
    file: string
    server: {
        ws: { send: Function }
        moduleGraph: {
            getModulesByFile: Function
            invalidateModule: Function
        }
    }
    read: () => string | Promise<string>
    timestamp: number
}

type ConfUpdate = {
    hmr: boolean
}

type ConfigLoader = () => Promise<Config>

export function toViteError(err: unknown, adapterKey: string, filename: string): never {
    const prefix = `${adapterKey}: transform failed for ${filename}`
    // Ensure we always throw an Error instance with a non-empty message so build tools (e.g. Vite)
    // don't end up printing only a generic "error during build:" line.
    if (err instanceof Error) {
        const anyErr = err as any
        const frame: string | undefined = typeof anyErr.frame === 'string' ? anyErr.frame : undefined
        if (!err.message || !err.message.startsWith(prefix)) {
            const details = err.message ? `\n${err.message}` : ''
            const frameText = frame ? `\n\n${frame}` : ''
            err.message = `${prefix}${details}${frameText}`
        }
        // Preserve useful metadata that some tooling expects.
        if (anyErr.id == null) anyErr.id = filename
        if (anyErr.loc == null && anyErr.start?.line != null && anyErr.start?.column != null) {
            anyErr.loc = { file: filename, line: anyErr.start.line, column: anyErr.start.column }
        }
        throw err
    }
    const rendered =
        typeof err === 'string' ? err : inspect(err, { depth: 5, breakLength: 120, maxStringLength: 10_000 })
    throw new Error(`${prefix}\n${rendered}`)
}

export class Wuchale {
    name = pluginName

    #config: Config
    #projectRoot: string = ''

    #adapters: Map<string, AdapterHandler> = new Map()
    #adaptersByConfUpdate: Map<string, AdapterHandler> = new Map()
    #adaptersByCatalogPath: Map<string, AdapterHandler[]> = new Map()
    #granularLoadAdapters: AdapterHandler[] = []
    #singleCompiledCatalogs: Set<string> = new Set()

    #log: Logger
    #mode: Mode

    #loadConfig: ConfigLoader

    #hmrVersion = -1
    #hmrDelayThreshold: number
    #lastSourceTriggeredPOWrite: number = 0

    constructor(loadConfig: () => Promise<Config>, root: string, hmrDelayThreshold = 1000) {
        this.#loadConfig = loadConfig
        this.#projectRoot = root
        // threshold to consider po file change is manual edit instead of a sideeffect of editing code
        this.#hmrDelayThreshold = hmrDelayThreshold
    }

    #init = async () => {
        this.#config = await this.#loadConfig()
        this.#log = new Logger(this.#config.logLevel)
        const adaptersData = Object.entries(this.#config.adapters)
        if (adaptersData.length === 0) {
            throw Error('At least one adapter is needed.')
        }
        const sharedStates = new SharedStates()
        const adaptersByLoaderPath: Map<string, AdapterHandler> = new Map()
        for (const [key, adapter] of adaptersData) {
            const handler = new AdapterHandler(adapter, key, this.#config, this.#mode, this.#projectRoot, this.#log)
            await handler.init(sharedStates)
            handler.onBeforeWritePO = () => {
                this.#lastSourceTriggeredPOWrite = performance.now()
            }
            this.#adapters.set(key, handler)
            if (adapter.granularLoad) {
                this.#granularLoadAdapters.push(handler)
            } else {
                for (const locale of this.#config.locales) {
                    this.#singleCompiledCatalogs.add(
                        normalizeSep(resolve(handler.files.getCompiledFilePath(locale, null))),
                    )
                }
            }
            for (const path of Object.values(handler.files.loaderPath)) {
                const loaderPath = normalizeSep(resolve(path))
                if (adaptersByLoaderPath.has(loaderPath)) {
                    const otherKey = adaptersByLoaderPath.get(loaderPath)?.key
                    if (otherKey === key) {
                        // same loader for both ssr and client, no problem
                        continue
                    }
                    throw new Error(
                        [
                            'While catalogs can be shared, the same loader cannot be used by multiple adapters',
                            `Conflicting: ${key} and ${otherKey}`,
                            'Specify a different loaderPath for one of them.',
                        ].join('\n'),
                    )
                }
                adaptersByLoaderPath.set(loaderPath, handler)
            }
            for (const fname of handler.catalogPathsToLocales.keys()) {
                const handlers = this.#adaptersByCatalogPath.get(fname)
                if (handlers) {
                    handlers.push(handler)
                } else {
                    this.#adaptersByCatalogPath.set(fname, [handler])
                }
            }
            const confUpdateFile = normalizeSep(resolve(handler.files.generatedDir, confUpdateName))
            await writeFile(confUpdateFile, '{}') // vite only watched changes so prepare first
            this.#adaptersByConfUpdate.set(confUpdateFile, handler)
        }
    }

    configResolved = async (config: { env: { DEV?: boolean } }) => {
        if (config.env.DEV) {
            this.#mode = 'dev'
        } else {
            this.#mode = 'build'
        }
        await this.#init()
    }

    handleHotUpdate = async (ctx: HotUpdateCtx) => {
        if (this.#adaptersByConfUpdate.has(ctx.file)) {
            const update: ConfUpdate = JSON.parse(await ctx.read())
            console.log(`${pluginName}: config update received:`, update)
            this.#config.hmr = update.hmr
            return []
        }
        if (!this.#config.hmr) {
            return
        }
        // This is mainly to make sure that PO catalog changes result in a page reload with new catalogs
        const adapters = this.#adaptersByCatalogPath.get(ctx.file)
        if (adapters == null) {
            // prevent reloading whole app because of a change in compiled catalog
            // triggered by extraction from single file, hmr handled by embedding patch
            if (this.#singleCompiledCatalogs.has(ctx.file)) {
                return []
            }
            // for granular as well
            for (const adapter of this.#granularLoadAdapters) {
                for (const loc of this.#config.locales) {
                    for (const id of adapter.granularState.byID.keys()) {
                        if (normalizeSep(resolve(adapter.files.getCompiledFilePath(loc, id))) === ctx.file) {
                            return []
                        }
                    }
                }
            }
            this.#hmrVersion++
            return
        }
        // catalog changed
        const sourceTriggered = performance.now() - this.#lastSourceTriggeredPOWrite < this.#hmrDelayThreshold
        const invalidatedModules = new Set()
        for (const adapter of adapters) {
            const loc = adapter.catalogPathsToLocales.get(ctx.file)!
            if (!sourceTriggered) {
                await adapter.loadCatalogNCompile(loc, this.#hmrVersion)
            }
            for (const loadID of adapter.getLoadIDs()[0]) {
                const fileID = normalizeSep(resolve(adapter.files.getCompiledFilePath(loc, loadID)))
                for (const module of ctx.server.moduleGraph.getModulesByFile(fileID) ?? []) {
                    ctx.server.moduleGraph.invalidateModule(module, invalidatedModules, ctx.timestamp, false)
                }
            }
        }
        if (!sourceTriggered) {
            ctx.server.ws.send({ type: 'full-reload' })
            return []
        }
    }

    #transformHandler = async (code: string, id: string, options?: { ssr?: boolean | undefined }) => {
        if (this.#mode === 'dev' && !this.#config.hmr) {
            return {}
        }
        let filename = relative(this.#projectRoot, id)
        const queryIndex = filename.indexOf('?')
        if (queryIndex >= 0) {
            const query = new URLSearchParams(filename.slice(queryIndex))
            if (query.size === 1 && query.has('v')) {
                // trim after this, like ?v=b65b2c3b when it's from node_modules
                filename = filename.slice(0, queryIndex)
            }
        }
        for (const adapter of this.#adapters.values()) {
            if (adapter.fileMatches(filename)) {
                try {
                    return await adapter.transform(code, filename, this.#hmrVersion, options?.ssr)
                } catch (err) {
                    toViteError(err, adapter.key, filename)
                }
            }
        }
        return {}
    }

    transform = { order: 'pre' as const, handler: this.#transformHandler }
}

export const wuchale = (configPath?: string, hmrDelayThreshold = 1000) => {
    return new Wuchale(() => getConfig(configPath), dirname(configPath ?? '.'), hmrDelayThreshold)
}
