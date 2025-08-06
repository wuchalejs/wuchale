// $$ cd ../.. && npm run test
import { type CompiledFragment } from "./compile.js"
import { relative, resolve } from "node:path"
import { getConfig as getConfig, type Config } from "./config.js"
import { AdapterHandler, pluginName, virtualPrefix } from "./handler.js"
import type {Mode} from './handler.js'
import { Logger } from "./adapters.js"

const virtualResolvedPrefix = '\0'

type HMRClient = {
    send: (event: string, data: CompiledFragment[]) => void
}

type ViteDevServer = {
    ws: {
        send: (event: string, data: CompiledFragment[]) => void,
        on: (event: string, cb: (msg: {loadID: string | null}, client: HMRClient) => void) => void,
    }
}

const transformOrder: 'pre' = 'pre'

class Plugin {

    name = pluginName

    #config: Config
    #projectRoot: string = ''

    #server: ViteDevServer

    #adapters: {[key: string]: AdapterHandler} = {}
    #adaptersByLoaderPath: {[loader: string]: AdapterHandler} = {}
    #adaptersByCatalogPath: {[path: string]: AdapterHandler} = {}

    #log: Logger

    #init = async (mode: Mode) => {
        this.#config = await getConfig()
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
            for (const loc of Object.keys(this.#config.locales)) {
                const event = adapter.virtModEvent(loc, null)
                server.ws.on(event, (payload, client) => {
                    const eventSend = adapter.virtModEvent(loc, payload.loadID)
                    if (!this.#config.adapters[key].granularLoad) {
                        client.send(eventSend, adapter.compiled[loc])
                        return
                    }
                    const compiled = adapter.granularStateByID[payload.loadID].compiled[loc]
                    client.send(eventSend, compiled)
                })
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
        if (!this.#config.adapters[adapter.key].granularLoad) {
            this.#server.ws.send(adapter.virtModEvent(loc, null), adapter.compiled[loc])
            return
        }
        for (const [loadID, state] of Object.entries(adapter.granularStateByID)) {
            const eventName = adapter.virtModEvent(loc, loadID)
            this.#server.ws.send(eventName, state.compiled[loc])
        }
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
            return `export const locales = {${Object.entries(this.#config.locales).map(([loc, {name}]) => `${loc}:'${name}'`).join(',')}}`
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

    transform = { order: transformOrder, handler: this.#transformHandler }
}

export default () => new Plugin()
