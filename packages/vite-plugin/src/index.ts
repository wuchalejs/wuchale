// $$ cd ../.. && npm run test
import { relative, resolve } from "node:path"
import { getConfig as getConfig, Logger, AdapterHandler } from "wuchale"
import type { Config, Mode, SharedStates } from "wuchale"

const pluginName = 'wuchale'
const virtualPrefix = `virtual:${pluginName}/`
const virtualResolvedPrefix = '\0'

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

class Plugin {

    name = pluginName

    #config: Config
    #locales: string[] = []
    #projectRoot: string = ''

    #adapters: Record<string, AdapterHandler> = {}
    #adaptersByLoaderPath: Record<string, AdapterHandler> = {}
    #adaptersByCatalogPath: Record<string, AdapterHandler[]> = {}

    #log: Logger

    #configPath: string

    #hmrVersion = -1
    #hmrLastTime = 0

    constructor(configPath: string) {
        this.#configPath = configPath
    }

    #init = async (mode: Mode) => {
        this.#config = await getConfig(this.#configPath)
        this.#locales = [this.#config.sourceLocale, ...this.#config.otherLocales]
        this.#log = new Logger(this.#config.messages)
        if (Object.keys(this.#config.adapters).length === 0) {
            throw Error('At least one adapter is needed.')
        }
        const sharedState: SharedStates = {}
        for (const [key, adapter] of Object.entries(this.#config.adapters)) {
            const handler = new AdapterHandler(
                adapter,
                key,
                this.#config,
                mode,
                virtualPrefix,
                this.#projectRoot,
                this.#log,
            )
            await handler.init(sharedState)
            this.#adapters[key] = handler
            for (const path of Object.values(handler.loaderPath)) {
                const loaderPath = resolve(path)
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
        let mode: Mode
        if (config.env.DEV) {
            mode = 'dev'
        } else {
            mode = 'prod'
        }
        this.#projectRoot = config.root
        await this.#init(mode)
    }

    handleHotUpdate = async (ctx: HotUpdateCtx) => {
        if (!(ctx.file in this.#adaptersByCatalogPath)) {
            this.#hmrVersion++
            this.#hmrLastTime = performance.now()
            return
        }
        const sourceTriggered = performance.now() - this.#hmrLastTime < 2000
        const invalidatedModules = new Set()
        for (const adapter of this.#adaptersByCatalogPath[ctx.file]) {
            const loc = adapter.catalogPathsToLocales[ctx.file]
            if (!sourceTriggered) {
                await adapter.loadCatalogNCompile(loc)
            }
            for (const loadID of adapter.getLoadIDs()) {
                const fileID = `${virtualResolvedPrefix}${adapter.virtModEvent(loc, loadID)}`
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

    resolveId = (source: string, importer?: string) => {
        if (!source.startsWith(virtualPrefix)) {
            return null
        }
        return `${virtualResolvedPrefix}${source}?importer=${importer}`
    }

    load = (id: string) => {
        const prefix = virtualResolvedPrefix + virtualPrefix
        if (!id.startsWith(prefix)) {
            return null
        }
        const [path, importer] = id.slice(prefix.length).split('?importer=')
        const [part, ...rest] = path.split('/')
        if (part === 'catalog') {
            const [adapterKey, loadID, locale] = rest
            const adapter = this.#adapters[adapterKey]
            if (adapter == null) {
                this.#log.error(`Adapter not found for key: ${adapterKey}`)
                return null
            }
            return adapter.loadCatalogModule(locale, loadID, this.#hmrVersion)
        }
        if (part === 'locales') {
            return `export const locales = ['${this.#locales.join("', '")}']`
        }
        if (part !== 'proxy') {
            this.#log.error(`Unknown virtual request: ${id}`)
            return null
        }
        // loader proxy
        const adapter = this.#adaptersByLoaderPath[importer]
        if (adapter == null) {
            this.#log.error(`Adapter not found for filename: ${importer}`)
            return
        }
        if (rest[0] === 'sync') {
            return adapter.getProxySync()
        }
        return adapter.getProxy()
    }

    #transformHandler = async (code: string, id: string, options: {ssr?: boolean}) => {
        if (!this.#config.hmr) {
            return {}
        }
        const filename = relative(this.#projectRoot, id)
        for (const adapter of Object.values(this.#adapters)) {
            if (adapter.fileMatches(filename)) {
                return await adapter.transform(code, filename, this.#hmrVersion, options.ssr)
            }
        }
        return {}
    }

    transform = { order: <'pre'>'pre', handler: this.#transformHandler }
}

export const wuchale = (configPath?: string) => new Plugin(configPath)
