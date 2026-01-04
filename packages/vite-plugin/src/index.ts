// $$ cd ../.. && npm run test
import { relative, resolve } from 'node:path'
import { platform } from 'node:process'
import type { Config, Mode, SharedStates } from 'wuchale'
import { AdapterHandler, getConfig, Logger } from 'wuchale'

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

class Wuchale {
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

    #configPath?: string

    #hmrVersion = -1
    #lastSourceTriggeredPOWrite: number = 0

    constructor(configPath?: string) {
        this.#configPath = configPath
    }

    #init = async () => {
        this.#config = await getConfig(this.#configPath)
        this.#log = new Logger(this.#config.logLevel)
        const adaptersData = Object.entries(this.#config.adapters)
        if (adaptersData.length === 0) {
            throw Error('At least one adapter is needed.')
        }
        const sharedState: SharedStates = new Map()
        const adaptersByLoaderPath: Map<string, AdapterHandler> = new Map()
        for (const [key, adapter] of adaptersData) {
            const handler = new AdapterHandler(adapter, key, this.#config, this.#mode, this.#projectRoot, this.#log)
            await handler.init(sharedState)
            handler.onBeforeWritePO = () => {
                this.#lastSourceTriggeredPOWrite = performance.now()
            }
            this.#adapters.set(key, handler)
            if (adapter.granularLoad) {
                this.#granularLoadAdapters.push(handler)
            } else {
                for (const locale of this.#config.locales) {
                    this.#singleCompiledCatalogs.add(resolve(handler.getCompiledFilePath(locale, null)))
                }
            }
            for (const path of Object.values(handler.loaderPath)) {
                let loaderPath = resolve(path)
                if (platform === 'win32') {
                    // seems vite does this for the importer field in the resolveId hook
                    loaderPath = loaderPath.replaceAll('\\', '/')
                }
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
            this.#adaptersByConfUpdate.set(resolve(adapter.localesDir, confUpdateName), handler)
        }
    }

    configResolved = async (config: { env: { DEV?: boolean }; root: string }) => {
        if (config.env.DEV) {
            this.#mode = 'dev'
        } else {
            this.#mode = 'build'
        }
        this.#projectRoot = config.root
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
                    for (const id in adapter.granularStateByID) {
                        if (resolve(adapter.getCompiledFilePath(loc, id)) === ctx.file) {
                            return []
                        }
                    }
                }
            }
            this.#hmrVersion++
            return
        }
        // catalog changed
        const sourceTriggered = performance.now() - this.#lastSourceTriggeredPOWrite < 1000 // long enough threshold
        const invalidatedModules = new Set()
        for (const adapter of adapters) {
            const loc = adapter.catalogPathsToLocales.get(ctx.file)!
            if (!sourceTriggered) {
                await adapter.loadCatalogNCompile(loc, this.#hmrVersion)
            }
            for (const loadID of adapter.getLoadIDs()) {
                const fileID = resolve(adapter.getCompiledFilePath(loc, loadID))
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
                return await adapter.transform(code, filename, this.#hmrVersion, options?.ssr)
            }
        }
        return {}
    }

    transform = { order: <'pre'>'pre', handler: this.#transformHandler }
}

export const wuchale = (configPath?: string) => new Wuchale(configPath)
