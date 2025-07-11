// $$ cd ../.. && npm run test
import { IndexTracker } from "./adapter.js"
import { type CompiledFragment } from "./compile.js"
import { relative } from "node:path"
import { getConfig as getConfig, type Config } from "../config.js"
import { AdapterHandler, pluginName, virtualPrefix } from "./handler.js"
import type {Mode, TranslationsByLocale, CompiledByLocale} from './handler.js'

const virtualResolvedPrefix = '\0'

type HMRCompiled = {
    adapter: string
    locale: string
    data: CompiledFragment[]
}

type HMRClient = {
    send: (event: string, data: HMRCompiled) => void
}

type ViteDevServer = {
    ws: {
        send: (event: string, data: HMRCompiled) => void,
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

    constructor(config: Config) {
        this.#config = config
    }

    #init = async (mode: Mode) => {
        this.#config = await getConfig(this.#config)
        const dedupeAdapters: {[catalog: string]: {
            index?: IndexTracker
            translations?: TranslationsByLocale
            compiled?: CompiledByLocale
        }} = {}
        for (const adapter of this.#config.adapters) {
            const dedupe = dedupeAdapters[adapter.catalog] ?? {}
            const handler = new AdapterHandler(
                adapter,
                this.#config, dedupe.index ?? new IndexTracker(),
                mode,
                this.#projectRoot,
            )
            await handler.init(dedupe.translations, dedupe.compiled)
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
        server.ws.on(`${pluginName}:get`, (msg: { adapter: string, locale: string }, client) => {
            const adapter = this.#adapters.find(t => t.name === adapter)
            if (!adapter) {
                console.warn('Hot update requested for non-existent adapter:', adapter)
                return
            }
            client.send(`${pluginName}:update`, {
                adapter: adapter.name,
                locale: msg.locale,
                data: adapter._compiled[msg.locale],
            })
        })
    }

    handleHotUpdate = async (ctx: ViteHotUpdateCTX) => {
        // PO file write -> JS HMR
        const adapter = this.#adapters.find(t => ctx.file in t.transFnamesToLocales)
        if (!adapter) {
            return
        }
        const loc = adapter.transFnamesToLocales[ctx.file]
        await adapter.loadTranslations(loc)
        adapter.compile(loc)
        this.#server.ws.send(`${pluginName}:update`, {
            adapter: adapter.name,
            locale: loc,
            data: adapter.compiled[loc],
        })
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
        const [adapterName, locale] = id.slice(prefix.length).split(':')
        const adapter = this.#adapters.find(t => t.name === adapterName)
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

export default async function wuchale(config: Config = {}) {
    return new Plugin(config)
}
