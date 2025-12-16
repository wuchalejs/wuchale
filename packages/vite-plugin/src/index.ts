// $$ cd ../.. && npm run test
import { relative, resolve } from "node:path"
import { platform } from "node:process"
import { getConfig as getConfig, Logger, AdapterHandler } from "wuchale"
import type { Config, Mode, SharedStates } from "wuchale"

const pluginName = 'wuchale'

type HotUpdateCtx = {
    file: string
    server: {
        ws: { send: Function }
        moduleGraph: {
            getModulesByFile: Function
            invalidateModule: Function
        }
    }
    timestamp: number
}

class Wuchale {

    name = pluginName

    #config: Config
    #projectRoot: string = ''

    #adapters: Record<string, AdapterHandler> = {}
    #adaptersByLoaderPath: Record<string, AdapterHandler> = {}
    #adaptersByCatalogPath: Record<string, AdapterHandler[]> = {}
    #granularLoadAdapters: AdapterHandler[] = []
    #singleCompiledCatalogs: Set<String> = new Set()
    #locales: string[] = []

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
        this.#locales = [this.#config.sourceLocale, ...this.#config.otherLocales]
        if (Object.keys(this.#config.adapters).length === 0) {
            throw Error('At least one adapter is needed.')
        }
        const sharedState: SharedStates = {}
        for (const [key, adapter] of Object.entries(this.#config.adapters)) {
            const handler = new AdapterHandler(
                adapter,
                key,
                this.#config,
                this.#mode,
                this.#projectRoot,
                this.#log,
            )
            await handler.init(sharedState)
            handler.onBeforeWritePO = () => {
                this.#lastSourceTriggeredPOWrite = performance.now()
            }
            this.#adapters[key] = handler
            if (adapter.granularLoad) {
                this.#granularLoadAdapters.push(handler)
            } else {
                for (const locale of this.#locales) {
                    this.#singleCompiledCatalogs.add(resolve(handler.getCompiledFilePath(locale, null)))
                }
            }
            for (const path of Object.values(handler.loaderPath)) {
                let loaderPath = resolve(path)
                if (platform === 'win32') {
                    // seems vite does this for the importer field in the resolveId hook
                    loaderPath = loaderPath.replaceAll('\\', '/')
                }
                if (loaderPath in this.#adaptersByLoaderPath) {
                    const otherKey = this.#adaptersByLoaderPath[loaderPath].key
                    if (otherKey === key) {
                        // same loader for both ssr and client, no problem
                        continue
                    }
                    throw new Error([
                        'While catalogs can be shared, the same loader cannot be used by multiple adapters',
                        `Conflicting: ${key} and ${otherKey}`,
                        'Specify a different loaderPath for one of them.'
                    ].join('\n'))
                }
                this.#adaptersByLoaderPath[loaderPath] = handler
            }
            for (const fname of Object.keys(handler.catalogPathsToLocales)) {
                this.#adaptersByCatalogPath[fname] ??= []
                this.#adaptersByCatalogPath[fname].push(handler)
            }
        }
    }

    configResolved = async (config: { env: { DEV?: boolean }, root: string }) => {
        if (config.env.DEV) {
            this.#mode = 'dev'
        } else {
            this.#mode = 'build'
        }
        this.#projectRoot = config.root
        await this.#init()
    }

    handleHotUpdate = async (ctx: HotUpdateCtx) => {
        if (!this.#config.hmr) {
            return
        }
        // This is mainly to make sure that PO catalog changes result in a page reload with new catalogs
        if (!(ctx.file in this.#adaptersByCatalogPath)) {
            // prevent reloading whole app because of a change in compiled catalog
            // triggered by extraction from single file, hmr handled by embedding patch
            if (this.#singleCompiledCatalogs.has(ctx.file)) {
                return []
            }
            // for granular as well
            for (const adapter of this.#granularLoadAdapters) {
                for (const loc of this.#locales) {
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
        for (const adapter of this.#adaptersByCatalogPath[ctx.file]) {
            const loc = adapter.catalogPathsToLocales[ctx.file]
            if (!sourceTriggered) {
                await adapter.loadCatalogNCompile(loc, this.#hmrVersion)
            }
            for (const loadID of adapter.getLoadIDs()) {
                const fileID = resolve(adapter.getCompiledFilePath(loc, loadID))
                for (const module of ctx.server.moduleGraph.getModulesByFile(fileID) ?? []) {
                    ctx.server.moduleGraph.invalidateModule(
                        module,
                        invalidatedModules,
                        ctx.timestamp,
                        false,
                    )
                }
            }
        }
        if (!sourceTriggered) {
            ctx.server.ws.send({ type: 'full-reload' })
            return []
        }
    }

    #transformHandler = async (code: string, id: string, options?: {ssr?: boolean}) => {
        if (this.#mode === 'dev' && !this.#config.hmr) {
            return {}
        }
        const filename = relative(this.#projectRoot, id)
        for (const adapter of Object.values(this.#adapters)) {
            if (adapter.fileMatches(filename)) {
                return await adapter.transform(code, filename, this.#hmrVersion, options?.ssr)
            }
        }
        return {}
    }

    transform = { order: <'pre'>'pre', handler: this.#transformHandler }
}

export const wuchale = (configPath?: string) => new Wuchale(configPath)
