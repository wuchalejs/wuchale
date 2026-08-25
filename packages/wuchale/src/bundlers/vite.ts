import { dirname } from 'node:path'
import { type Config, getConfig } from '../config.js'
import { Hub, pluginName } from '../hub.js'

export function toViteError(err: any, adapterKey: string, filename: string): Error {
    const prefix = `${adapterKey}: transform failed for ${filename}`
    // Ensure we always throw an Error instance with a non-empty message so build tools (e.g. Vite)
    // don't end up printing only a generic "error during build:" line.
    const frame: string | undefined = typeof err.frame === 'string' ? err.frame : undefined
    if (!err.message?.startsWith(prefix)) {
        const details = err.message ? `\n${err.message}` : ''
        const frameText = frame ? `\n\n${frame}` : ''
        err.message = `${prefix}${details}${frameText}`
    }
    // Preserve useful metadata that some tooling expects.
    if (err.id == null) err.id = filename
    if (err.loc == null && err.start?.line != null && err.start?.column != null) {
        err.loc = { file: filename, line: err.start.line, column: err.start.column }
    }
    return err
}

export function trimViteQueries(id: string, trimParams: Set<string>) {
    const queryStart = id.indexOf('?')
    if (queryStart === -1) {
        return id
    }
    let currentI = queryStart + 1
    const lastI = id.length + 1
    let allTrimmed = true
    do {
        let nextI = id.indexOf('&', currentI)
        if (nextI === -1) {
            nextI = lastI
        }
        let endI = id.indexOf('=', currentI)
        if (endI === -1 || endI > nextI) {
            endI = nextI
        }
        if (!trimParams.has(id.slice(currentI, endI))) {
            allTrimmed = false
            break
        }
        currentI = nextI + 1
    } while (currentI < lastI)
    if (allTrimmed) {
        id = id.slice(0, queryStart)
    }
    return id
}

type HotUpdateCtx = {
    file: string
    server: { ws: { send: (...a: any[]) => any } }
    read: () => string | Promise<string>
    timestamp: number
}

export type PluginConf = {
    configPath?: string
    hmrDelayThreshold?: number
    trimQueryParams?: string[]
}

const defaultTrimParams = ['v', 't', 'sentry-auto-wrap', 'tsr-split']

export const wuchale = ({ configPath, hmrDelayThreshold = 1000, trimQueryParams }: PluginConf = {}) => {
    let inBuild: boolean, conf: Config, hub: Hub
    const trimParams = new Set([...(trimQueryParams ?? []), ...defaultTrimParams])
    return {
        name: pluginName,
        async config(_: any, env: { mode: string }) {
            inBuild = env.mode === 'build'
            conf = await getConfig(configPath)
            return {
                optimizeDeps: { include: [...new Set(Object.values(conf.adapters).flatMap(a => a.addImports))] },
            }
        },
        async buildStart() {
            hub = await Hub.create(
                inBuild ? 'build' : 'dev',
                conf,
                dirname(configPath ?? '.'),
                [],
                hmrDelayThreshold,
                undefined,
                toViteError,
            )
        },
        async handleHotUpdate(ctx: HotUpdateCtx) {
            const sourceTriggered = await hub?.onFileChange(ctx.file, ctx.read) // ignore when not ready
            if (sourceTriggered === undefined) {
                return
            }
            if (!sourceTriggered) {
                ctx.server.ws.send({ type: 'full-reload' })
            }
            return []
        },
        async transform(code: string, id: string, options?: { ssr?: boolean | undefined }) {
            const [output] = await hub.transform(code, trimViteQueries(id, trimParams), options?.ssr)
            return output
        },
    }
}
