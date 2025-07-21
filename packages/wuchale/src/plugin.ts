// $$ cd ../.. && npm run test
import { type CompiledFragment } from "./compile.js"
import { relative, resolve } from "node:path"
import { getConfig as getConfig, type Config } from "./config.js"
import { AdapterHandler, pluginName, virtualPFLoader, virtualPrefix } from "./handler.js"
import type {Mode} from './handler.js'
import { readFile } from "node:fs/promises"

const virtualResolvedPrefix = '\0'
const importerSep = '-_-_-' // looks like w :D

type HMRClient = {
    send: (event: string, data: CompiledFragment[]) => void
}

type ViteDevServer = {
    ws: {
        send: (event: string, data: CompiledFragment[]) => void,
        on: (event: string, cb: (msg: {importer: string | null}, client: HMRClient) => void) => void,
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

    #perFilePathsToIds: {[file: string]: number} = {}
    #perFileIdsToPaths: {[id: number]: string} = {}

    transform: { order: 'pre', handler: any }

    #init = async (mode: Mode) => {
        this.#config = await getConfig()
        if (Object.keys(this.#config.adapters).length === 0) {
            throw Error('At least one adapter is needed.')
        }
        for (const adapter of this.#config.adapters) {
            const handler = new AdapterHandler(
                adapter,
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
                server.ws.on(event, (pl, client) => {
                    if (pl?.importer) {
                        client.send(event, adapter.compiledPerFile[loc][pl.importer])
                    } else {
                        client.send(event, adapter.compiled[loc])
                    }
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
                for (const file of Object.keys(adapter.compiledPerFile[loc])) {
                    const pfId = this.#perFilePathsToIds[file]
                    if (pfId == null) {
                        continue
                    }
                    const eventName = `${adapter.virtModEvent(loc)}.${pfId}`
                    this.#server.ws.send(eventName, adapter.compiledPerFile[loc][file])
                }
            } else {
                this.#server.ws.send(adapter.virtModEvent(loc), adapter.compiled[loc])
            }
            return
        }
    }

    resolveId = (source: string, importer: string) => {
        if (!source.startsWith(virtualPrefix)) {
            return null
        }
        const relImporter = relative(process.cwd(), importer)
        if (source !== virtualPFLoader) {
            return `${virtualResolvedPrefix}${source}?${relImporter}`
        }
        for (const [i, adapter] of this.#adapters.entries()) {
            if (!adapter.patterns.find(isMatch => isMatch(relImporter))) {
                continue
            }
            if (!(relImporter in this.#perFilePathsToIds)) {
                const id = Object.keys(this.#perFilePathsToIds).length
                this.#perFilePathsToIds[relImporter] = id
                this.#perFileIdsToPaths[id] = relImporter
            }
            const loaderExt = this.#config.adapters[i].loaderExt
            const pfId = this.#perFilePathsToIds[relImporter]
            return `${resolve(adapter.loaderPath)}${importerSep}${pfId}${loaderExt}`
        }
        return null
    }

    load = (id: string) => {
        const [pfPath, pfImporter] = id.split(importerSep)
        if (pfPath in this.#loadersBodyByLoader) {
            return this.#loadersBodyByLoader[pfPath] // same loader for all
        }
        let [path, qp1, qp2] = pfPath.split('?')
        const prefix = virtualResolvedPrefix + virtualPrefix
        if (!id.startsWith(prefix)) {
            return null
        }
        path = path.slice(prefix.length)
        const [part, ...rest] = path.split('/')
        if (part === 'catalog') {
            const importer = qp2
            const iAdapter = this.#adapters.findIndex(a => a.loaderPath === importer)
            if (iAdapter === -1) {
                console.error('Adapter not found for:', importer)
                return null
            }
            const perFileId = pfImporter?.slice(0, -this.#config.adapters[iAdapter].loaderExt.length)
            const destImport = this.#perFileIdsToPaths[perFileId]
            const adapter = this.#adapters[iAdapter]
            const locale = rest[0]
            const eventName = `${adapter.virtModEvent(locale)}.${perFileId}`
            return adapter.loadDataModule(locale, eventName, destImport)
        }
        if (part === 'locales') {
            return `export const locales = {${Object.entries(this.#config.locales).map(([loc, {name}]) => `${loc}:'${name}'`).join(',')}}`
        }
        if (part !== 'loader') {
            console.error('Unknown virtual request:', id)
            return null
        }
        const importer = qp1
        // data loader
        const iAdapter = this.#adapters.findIndex(a => a.loaderPath === importer)
        if (iAdapter === -1) {
            console.error('Adapter not found for filename:', importer)
            return
        }
        const adapter = this.#adapters[iAdapter]
        const perFileId = pfImporter?.slice(0, -this.#config.adapters[iAdapter].loaderExt.length)
        if (rest[0] === 'sync') {
            return adapter.getLoaderSync(perFileId)
        }
        return adapter.getLoader(perFileId)
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
