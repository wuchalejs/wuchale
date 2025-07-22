// $$ cd ../.. && npm run test
import { type CompiledFragment } from "./compile.js"
import { relative, resolve } from "node:path"
import { getConfig as getConfig, type Config } from "./config.js"
import { AdapterHandler, pluginName, virtualPrefix } from "./handler.js"
import type {Mode} from './handler.js'

const virtualResolvedPrefix = '\0'

type HMRClient = {
    send: (event: string, data: CompiledFragment[]) => void
}

type ViteDevServer = {
    ws: {
        send: (event: string, data: CompiledFragment[]) => void,
        on: (event: string, cb: (msg: {fileID: string | null}, client: HMRClient) => void) => void,
    }
}

class Plugin {

    name = pluginName

    #config: Config
    #projectRoot: string = ''

    #server: ViteDevServer

    #adapters: {[key: string]: AdapterHandler} = {}
    #adaptersByLoaderPath: {[loader: string]: AdapterHandler} = {}
    #adaptersByCatalogPath: {[path: string]: AdapterHandler} = {}

    #init = async (mode: Mode) => {
        this.#config = await getConfig()
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
            )
            await handler.init()
            this.#adapters[key] = handler
            this.#adaptersByLoaderPath[resolve(handler.loaderPath)] = handler
            for (const loc of Object.keys(this.#config.locales)) {
                this.#adaptersByCatalogPath[handler.transFnamesToLocales[loc]] = handler
            }
        }
    }

    configResolved = async (config: { env: { DEV?: boolean }, root: string }) => {
        let mode: Mode
        if (config.env.DEV) {
            mode = 'dev'
        } else if (config.env.DEV == null) {
            mode = 'test'
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
                    const eventSend = adapter.virtModEvent(loc, payload.fileID)
                    if (!this.#config.adapters[key].perFile) {
                        client.send(eventSend, adapter.compiled[loc])
                        return
                    }
                    const compiled = adapter.perFileStateByID[payload.fileID].compiled[loc]
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
        const loc = adapter.transFnamesToLocales[ctx.file]
        await adapter.loadCatalogNCompile(loc)
        if (!this.#config.adapters[adapter.key].perFile) {
            this.#server.ws.send(adapter.virtModEvent(loc, null), adapter.compiled[loc])
            return
        }
        for (const [fileID, state] of Object.entries(adapter.perFileStateByID)) {
            const eventName = adapter.virtModEvent(loc, fileID)
            this.#server.ws.send(eventName, state.compiled[loc])
        }
    }

    resolveId = (source: string, importer: string) => {
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
            const [adapterKey, fileID, locale] = rest
            const adapter = this.#adapters[adapterKey]
            if (adapter == null) {
                console.error('Adapter not found for key:', adapterKey)
                return null
            }
            return adapter.loadDataModule(locale, fileID)
        }
        if (part === 'locales') {
            return `export const locales = {${Object.entries(this.#config.locales).map(([loc, {name}]) => `${loc}:'${name}'`).join(',')}}`
        }
        if (part !== 'loader') {
            console.error('Unknown virtual request:', id)
            return null
        }
        // data loader
        const adapter = this.#adaptersByLoaderPath[importer]
        if (adapter == null) {
            console.error('Adapter not found for filename:', importer)
            return
        }
        if (rest[0] === 'sync') {
            return adapter.getLoaderSync()
        }
        return adapter.getLoader()
    }

    #transformHandler = async (code: string, id: string) => {
        if (!this.#config.hmr) {
            return {}
        }
        const filename = relative(this.#projectRoot, id)
        for (const adapter of Object.values(this.#adapters)) {
            if (adapter.patterns.find(isMatch => isMatch(filename))) {
                return await adapter.transform(code, filename)
            }
        }
        return {}
    }

    transform = { order: 'pre', handler: this.#transformHandler }
}

export default () => new Plugin()
