// $$ cd ../.. && npm run test
import { IndexTracker } from "./transform.js"
import { type CompiledFragment } from "./compile.js"
import { relative } from "node:path"
import { getConfig as getConfig, type Config } from "../config.js"
import { TransformHandler, pluginName, virtualPrefix } from "./handler.js"
import type {TransformMode, TranslationsByLocale, CompiledByLocale} from './handler.js'

const virtualResolvedPrefix = '\0'

type HMRCompiled = {
    transformer: string
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

    #transformers: TransformHandler[] = []

    transform: { order: 'pre', handler: any }

    constructor(config: Config) {
        this.#config = config
    }

    #init = async (mode: TransformMode) => {
        this.#config = await getConfig(this.#config)
        const dedupeTrans: {[translationFile: string]: {
            index?: IndexTracker
            translations?: TranslationsByLocale
            compiled?: CompiledByLocale
        }} = {}
        for (const transf of this.#config.transformers) {
            const dedupe = dedupeTrans[transf.catalog] ?? {}
            const transformer = new TransformHandler(
                transf,
                this.#config, dedupe.index ?? new IndexTracker(),
                mode,
                this.#projectRoot,
            )
            await transformer.init(dedupe.translations, dedupe.compiled)
            this.#transformers.push(transformer)
        }
        if (this.#config.hmr) {
            this.transform = {
                order: 'pre',
                handler: this.#transformHandler,
            }
        }
    }

    configResolved = async (config: { env: { DEV?: boolean }, root: string }) => {
        let mode: TransformMode
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
        server.ws.on(`${pluginName}:get`, (msg: { transformer: string, locale: string }, client) => {
            const transformer = this.#transformers.find(t => t.name === transformer)
            if (!transformer) {
                console.warn('Hot update requested for non-existent transformer:', transformer)
                return
            }
            client.send(`${pluginName}:update`, {
                transformer: transformer.name,
                locale: msg.locale,
                data: transformer._compiled[msg.locale],
            })
        })
    }

    handleHotUpdate = async (ctx: ViteHotUpdateCTX) => {
        // PO file write -> JS HMR
        const transformer = this.#transformers.find(t => ctx.file in t.transFnamesToLocales)
        if (!transformer) {
            return
        }
        const loc = transformer.transFnamesToLocales[ctx.file]
        await transformer.loadTranslations(loc)
        transformer.compile(loc)
        this.#server.ws.send(`${pluginName}:update`, {
            transformer: transformer.name,
            locale: loc,
            data: transformer.compiled[loc],
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
        const [transformerName, locale] = id.slice(prefix.length).split(':')
        const transformer = this.#transformers.find(t => t.name === transformerName)
        if (!transformer) {
            console.error('Transformer not found for:', transformerName)
            return
        }
        return transformer.loadProxyMod(locale)
    }

    #transformHandler = async (code: string, id: string) => {
        const filename = relative(this.#projectRoot, id)
        for (const transformer of this.#transformers) {
            if (transformer.patterns.find(isMatch => isMatch(filename))) {
                return await transformer.transform(code, filename)
            }
        }
        return {}
    }
}

export default async function wuchale(config: Config = {}) {
    return new Plugin(config)
}
