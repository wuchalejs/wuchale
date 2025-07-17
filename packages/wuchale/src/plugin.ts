// $$ cd ../.. && npm run test
import { IndexTracker } from "./adapter.js"
import { type CompiledFragment } from "./compile.js"
import { relative } from "node:path"
import { getConfig as getConfig, type Config } from "./config.js"
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

    resolveId = (source: string, importer: string) => {
        if (source.startsWith(virtualPrefix)) {
            return `${virtualResolvedPrefix}${source}?importer=${importer}`
        }
        return null
    }

    load = (id: string) => {
        const prefix = virtualResolvedPrefix + virtualPrefix
        if (!id.startsWith(prefix)) {
            return null
        }
        id = id.slice(prefix.length)
        const [path, qp] = id.split('?')
        const [part, ...rest] = path.split('/')
        if (part === 'catalog') {
            const [key, locale] = rest
            const adapter = this.#adapters.find(t => t.key === key)
            if (!adapter) {
                console.error('Adapter not found for:', key)
                return null
            }
            return adapter.loadDataModule(locale)
        }
        if (part !== 'loader') {
            console.error('Unknown virtual request:', id)
            return null
        }
        // data loader
        const importer = qp.slice('importer='.length)
        const adapter = this.#adapters.find(a => a.loaderPath === importer)
        if (!adapter) {
            console.error('Adapter not found for filename:', importer)
            return
        }
        if (rest[0] === 'sync') {
            return adapter.loaderSync
        }
        return adapter.loader
    }

    #transformHandler = async (code: string, id: string) => {
        const filename = relative(this.#projectRoot, id)
        for (const adapter of this.#adapters) {
            if (adapter.patterns.find(isMatch => isMatch(filename))) {
                const r = await adapter.transform(code, filename)
                console.log(filename)
                return r
            }
        }
        return {}
    }
}

export default () => new Plugin()
