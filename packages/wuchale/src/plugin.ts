// $$ cd ../.. && npm run test
import { type CompiledFragment } from "./compile.js"
import { relative, resolve } from "node:path"
import { getConfig as getConfig, type Config } from "./config.js"
import { AdapterHandler, pluginName, virtualPrefix } from "./handler.js"
import type {Mode} from './handler.js'
import { readFile } from "node:fs/promises"

const virtualResolvedPrefix = '\0'

type HMRClient = {
    send: (event: string, data: CompiledFragment[]) => void
}

type ViteDevServer = {
    ws: {
        send: (event: string, data: CompiledFragment[]) => void,
        on: (event: string, cb: (msg: {fileID: string | null}, client: HMRClient) => void) => void,
    }
    moduleGraph: {
        getModuleById: Function,
        invalidateModule: Function,
    },
}

type ViteHotUpdateCTX = {
  file: string
  timestamp: number
  read: () => string | Promise<string>
  server: ViteDevServer
}

class Plugin {

    name = pluginName

    #config: Config
    #projectRoot: string = ''

    #server: ViteDevServer

    #adapters: AdapterHandler[] = []
    #loadersBodyByLoader: {[loader: string]: string} = {}

    #init = async (mode: Mode) => {
        this.#config = await getConfig()
        if (Object.keys(this.#config.adapters).length === 0) {
            throw Error('At least one adapter is needed.')
        }
        for (const [i, adapter] of this.#config.adapters.entries()) {
            const handler = new AdapterHandler(
                adapter,
                i,
                this.#config,
                mode,
                this.#projectRoot,
            )
            await handler.init()
            this.#adapters.push(handler)
            if (adapter.perFile) {
                const loaderRel = await readFile(handler.loaderPath)
                this.#loadersBodyByLoader[resolve(handler.loaderPath)] = loaderRel.toString()
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
        for (const [i, adapter] of this.#adapters.entries()) {
            for (const loc of Object.keys(this.#config.locales)) {
                const event = adapter.virtModEvent(loc, null)
                server.ws.on(event, (payload, client) => {
                    const eventSend = adapter.virtModEvent(loc, payload.fileID)
                    if (!this.#config.adapters[i].perFile) {
                        client.send(eventSend, adapter.compiled[loc])
                        return
                    }
                    const compiled = adapter.perFileStateByID[payload.fileID].compiled[loc]
                    client.send(eventSend, compiled)
                })
            }
        }
    }

    handleHotUpdate = async (ctx: ViteHotUpdateCTX) => {
        for (const [i, adapter] of this.#adapters.entries()) {
            if (!(ctx.file in adapter.transFnamesToLocales)) {
                continue
            }
            // PO file write -> JS HMR
            const loc = adapter.transFnamesToLocales[ctx.file]
            await adapter.loadCatalogNCompile(loc)
            if (this.#config.adapters[i].perFile) {
                for (const [fileID, state] of Object.entries(adapter.perFileStateByID)) {
                    const eventName = adapter.virtModEvent(loc, fileID)
                    this.#server.ws.send(eventName, state.compiled[loc])
                }
            } else {
                this.#server.ws.send(adapter.virtModEvent(loc, null), adapter.compiled[loc])
            }
            return
        }
    }

    resolveId = (source: string, importer: string) => {
        if (!source.startsWith(virtualPrefix)) {
            return null
        }
        const relImporter = relative(process.cwd(), importer)
        return `${virtualResolvedPrefix}${source}?${relImporter}`
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
        const iAdapter = this.#adapters.findIndex(a => a.loaderPath === importer)
        if (iAdapter === -1) {
            console.error('Adapter not found for filename:', importer)
            return
        }
        const adapter = this.#adapters[iAdapter]
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
        for (const adapter of this.#adapters) {
            if (adapter.patterns.find(isMatch => isMatch(filename))) {
                return await adapter.transform(code, filename)
            }
        }
        return {}
    }

    transform = { order: 'pre', handler: this.#transformHandler }
}

export default () => new Plugin()
