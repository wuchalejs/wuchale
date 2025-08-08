// $$ cd ../.. && npm run test
import { relative, resolve } from "node:path"
import { getConfig as getConfig, type Config } from "wuchale/config"
import { AdapterHandler } from "wuchale/handler"
import type {Mode} from 'wuchale/handler'
import { Logger } from "wuchale/log"

const pluginName = 'wuchale'
const virtualPrefix = `virtual:${pluginName}/`
const virtualResolvedPrefix = '\0'

type SendFunc = (event: string, data: any[]) => void
type HMRClient = { send: SendFunc }

type ViteDevServer = {
    ws: {
        send: SendFunc,
        on: (event: string, cb: (msg: {loadID: string | null}, client: HMRClient) => void) => void,
    }
}

class Plugin {

    name = pluginName

    #config: Config
    #locales: string[] = []
    #projectRoot: string = ''

    #server: ViteDevServer

    #adapters: Record<string, AdapterHandler> = {}
    #adaptersByLoaderPath: Record<string, AdapterHandler> = {}
    #adaptersByCatalogPath: Record<string, AdapterHandler> = {}

    #log: Logger

    #configPath: string

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
            await handler.init()
            this.#adapters[key] = handler
            this.#adaptersByLoaderPath[resolve(handler.loaderPath)] = handler
            for (const fname of Object.keys(handler.catalogPathsToLocales)) {
                this.#adaptersByCatalogPath[fname] = handler
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

    configureServer = (server: ViteDevServer) => {
        this.#server = server
        // initial load
        for (const [key, adapter] of Object.entries(this.#adapters)) {
            for (const loc of this.#locales) {
                const event = adapter.virtModEvent(loc, null)
                server.ws.on(event, (payload, client) => {
                    const eventSend = adapter.virtModEvent(loc, payload.loadID)
                    if (!this.#config.adapters[key].granularLoad) {
                        client.send(eventSend, adapter.compiled[loc].items)
                        return
                    }
                    const compiled = adapter.granularStateByID[payload.loadID].compiled[loc]
                    client.send(eventSend, compiled.items)
                })
            }
        }
    }

    #sendUpdateToClient = (adapter: AdapterHandler, locales: string[]) => {
        if (!this.#server) {
            // maybe not in dev mode
            return
        }
        for (const loc of locales) {
            if (!this.#config.adapters[adapter.key].granularLoad) {
                this.#server.ws.send(adapter.virtModEvent(loc, null), adapter.compiled[loc].items)
                return
            }
            for (const [loadID, state] of Object.entries(adapter.granularStateByID)) {
                const eventName = adapter.virtModEvent(loc, loadID)
                this.#server.ws.send(eventName, state.compiled[loc].items)
            }
        }
    }

    handleHotUpdate = async (ctx: {file: string}) => {
        if (!(ctx.file in this.#adaptersByCatalogPath)) {
            return
        }
        const adapter = this.#adaptersByCatalogPath[ctx.file]
        const loc = adapter.catalogPathsToLocales[ctx.file]
        await adapter.loadCatalogNCompile(loc)
        this.#sendUpdateToClient(adapter, [loc])
    }

    resolveId = (source: string, importer?: string) => {
        if (!source.startsWith(virtualPrefix)) {
            return null
        }
        return `${virtualResolvedPrefix}${source}?${importer}`
    }

    load = (id: string) => {
        const prefix = virtualResolvedPrefix + virtualPrefix
        if (!id.startsWith(prefix)) {
            return null
        }
        const [path, importer] = id.slice(prefix.length).split('?')
        const [part, ...rest] = path.split('/')
        if (part === 'catalog') {
            const [adapterKey, loadID, locale] = rest
            const adapter = this.#adapters[adapterKey]
            if (adapter == null) {
                this.#log.error(`Adapter not found for key: ${adapterKey}`)
                return null
            }
            return adapter.loadDataModule(locale, loadID)
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
                const {catalogChanged, ...output} = await adapter.transform(code, filename)
                if (catalogChanged) {
                    this.#sendUpdateToClient(adapter, this.#locales)
                }
                return output
            }
        }
        return {}
    }

    transform = { order: <'pre'>'pre', handler: this.#transformHandler }
}

export const wuchale = (configPath?: string) => new Plugin(configPath)
