// $$ cd ../.. && npm run test
import { relative, resolve } from "node:path"
import { getConfig as getConfig, Logger, AdapterHandler } from "wuchale"
import type { Config, Mode, CompiledElement} from "wuchale"
import { catalogVarName } from "wuchale/runtime"
import type { SharedStates } from "../../wuchale/dist/handler.js"

const pluginName = 'wuchale'
const virtualPrefix = `virtual:${pluginName}/`
const virtualResolvedPrefix = '\0'

type ViteDevServer = {
    ws: { send: (event: string, data: CompiledElement[]) => void }
    moduleGraph: any
}

class Plugin {

    name = pluginName

    #config: Config
    #locales: string[] = []
    #projectRoot: string = ''

    #mode: Mode

    #adapters: Record<string, AdapterHandler> = {}
    #adaptersByLoaderPath: Record<string, AdapterHandler> = {}
    #adaptersByCatalogPath: Record<string, AdapterHandler[]> = {}

    #log: Logger

    #configPath: string

    constructor(configPath: string) {
        this.#configPath = configPath
    }

    #init = async (mode: Mode) => {
        this.#config = await getConfig(this.#configPath)
        this.#locales = [this.#config.sourceLocale, ...this.#config.otherLocales]
        this.#log = new Logger(this.#config.messages)
        this.#mode = mode
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
            const loaderPath = resolve(handler.loaderPath)
            if (loaderPath in this.#adaptersByLoaderPath) {
                throw new Error([
                    'While catalogs can be shared, the same loader cannot be used by multiple adapters',
                    `Conflicting: ${key} and ${this.#adaptersByLoaderPath[loaderPath].key}`,
                    'Specify a different loaderPath for one of them.'
                ].join('\n'))
            }
            this.#adaptersByLoaderPath[loaderPath] = handler
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

    #loadCatalog(adapter: AdapterHandler, locale: string, loadID: string | null) {
        const module = adapter.loadDataModule(locale, loadID)
        if (this.#mode !== 'dev') {
            return module
        }
        return `
            ${module}
            let updateCallbacks = new Set()
            export const onUpdate = callback => { updateCallbacks.add(callback); console.log('sub', '${loadID}', updateCallbacks.size) }
            export const offUpdate = callback => { updateCallbacks.delete(callback); console.log('uns', '${loadID}', updateCallbacks.size) }
            if (import.meta.hot) {
                import.meta.hot.on('${adapter.virtModEvent(locale, loadID)}', newData => {
                    ${catalogVarName} = newData
                    for (const callback of updateCallbacks) {
                        callback(newData)
                    }
                })
            }
        `
    }

    handleHotUpdate = async (ctx: { file: string, server: ViteDevServer, timestamp: number }) => {
        if (!(ctx.file in this.#adaptersByCatalogPath)) {
            return
        }
        const adapters = this.#adaptersByCatalogPath[ctx.file]
        for (const adapter of adapters) {
            const loc = adapter.catalogPathsToLocales[ctx.file]
            await adapter.loadCatalogNCompile(loc)
            const loadIDsToInvalidate: string[] = []
            if (this.#config.adapters[adapter.key].granularLoad) {
                for (const [loadID, state] of Object.entries(adapter.granularStateByID)) {
                    loadIDsToInvalidate.push(loadID)
                    const eventName = adapter.virtModEvent(loc, loadID)
                    ctx.server.ws.send(eventName, state.compiled[loc].items)
                }
            } else {
                loadIDsToInvalidate.push(null)
                ctx.server.ws.send(adapter.virtModEvent(loc, null), adapter.sharedState.compiled[loc].items)
            }
            // invalidate for next reload
            const invalidatedModules = new Set()
            for (const loadID of loadIDsToInvalidate) {
                const fileID = `${virtualResolvedPrefix}${adapter.virtModEvent(loc, loadID)}`
                for (const module of ctx.server.moduleGraph.getModulesByFile(fileID) ?? []) { 
                    ctx.server.moduleGraph.invalidateModule(
                        module,
                        invalidatedModules,
                        ctx.timestamp,
                        false // no hmr, already sent event
                    )
                }
            }
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
            return this.#loadCatalog(adapter, locale, loadID)
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

    #transformHandler = async (code: string, id: string) => {
        if (!this.#config.hmr) {
            return {}
        }
        const filename = relative(this.#projectRoot, id)
        for (const adapter of Object.values(this.#adapters)) {
            if (adapter.fileMatches(filename)) {
                return await adapter.transform(code, filename)
            }
        }
        return {}
    }

    transform = { order: <'pre'>'pre', handler: this.#transformHandler }
}

export const wuchale = (configPath?: string) => new Plugin(configPath)
