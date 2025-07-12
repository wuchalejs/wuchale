// $$ cd ../.. && npm run test
import { IndexTracker } from "./adapter.js"
import { type CompiledFragment } from "./compile.js"
import { relative } from "node:path"
import { getConfig as getConfig, type Config } from "../config.js"
import { AdapterHandler, pluginName, virtualPrefix } from "./handler.js"
import type {Mode, CatalogssByLocale} from './handler.js'

const virtualResolvedPrefix = '\0'

type HMRClient = {
    send: (event: string, data: CompiledFragment[]) => void
}

type ViteDevServer = {
    ws: {
        send: (event: string, data: CompiledFragment[]) => void,
        on: (event: string, cb: (msg: object, client: HMRClient) => void) => void,
    }
    moduleGraph: {
        getModuleById: Function,
        invalidateModule: Function,
    },
}

type ViteHotUpdateCTX = {
    file: string,
    server: ViteDevServer,
    timestamp: number,
}

class Plugin {

    name = pluginName

    #config: Config
    #projectRoot: string = ''

    #server: ViteDevServer

    #adapters: AdapterHandler[] = []

    transform: { order: 'pre', handler: any }

    #init = async (mode: Mode) => {
        this.#config = await getConfig()
        if (Object.keys(this.#config.adapters).length === 0) {
            throw Error('At least one adapter is needed.')
        }
        const dedupeCatalogs: {[catalog: string]: {
            index?: IndexTracker
            catalogs?: CatalogssByLocale
        }} = {}
        for (const [key, adapter] of Object.entries(this.#config.adapters)) {
            const dedupe = dedupeCatalogs[adapter.catalog] ?? {}
            const handler = new AdapterHandler(
                adapter,
                key,
                this.#config, dedupe.index ?? new IndexTracker(),
                mode,
                this.#projectRoot,
            )
            await handler.init(dedupe.catalogs)
            this.#adapters.push(handler)
        }
        if (this.#config.hmr) {
            this.transform = {
                order: 'pre',
                handler: this.#transformHandler,
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
        for (const adapter of this.#adapters) {
            for (const loc of Object.keys(this.#config.locales)) {
                const event = adapter.virtModEvent(loc)
                server.ws.on(event, (_, client) => {
                    client.send(event, adapter.compiled[loc])
                })
            }
        }
    }

    handleHotUpdate = async (ctx: ViteHotUpdateCTX) => {
        // PO file write -> JS HMR
        const adapter = this.#adapters.find(t => ctx.file in t.transFnamesToLocales)
        if (!adapter) {
            return
        }
        const loc = adapter.transFnamesToLocales[ctx.file]
        await adapter.loadCatalogNCompile(loc)
        this.#server.ws.send(adapter.virtModEvent(loc), adapter.compiled[loc])
    }

    resolveId = (source: string) => {
        if (source.startsWith(virtualPrefix)) {
            return virtualResolvedPrefix + source
        }
        return null
    }

    load = (id: string) => {
        const prefix = virtualResolvedPrefix + virtualPrefix
        if (!id.startsWith(prefix)) {
            return null
        }
        const [locale, adapterName] = id.slice(prefix.length).split(':')
        const adapter = this.#adapters.find(t => t.key === adapterName)
        if (!adapter) {
            console.error('Adapter not found for:', adapterName)
            return
        }
        return adapter.loadDataModule(locale)
    }

    #transformHandler = async (code: string, id: string) => {
        const filename = relative(this.#projectRoot, id)
        for (const adapter of this.#adapters) {
            if (adapter.patterns.find(isMatch => isMatch(filename))) {
                return await adapter.transform(code, filename)
            }
        }
        return {}
    }
}

export default () => new Plugin()
