import { dirname } from 'node:path'
import { getConfig } from 'wuchale'
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
    server: {
        ws: { send: (...a: any[]) => any }
        moduleGraph: {
            getModulesByFile: (...a: any[]) => any
            invalidateModule: (...a: any[]) => any
        }
    }
    read: () => string | Promise<string>
    timestamp: number
}

export type PluginConf = {
    configPath?: string
    hmrDelayThreshold?: number
    trimQueryParams?: string[]
}

export const wuchale = ({ configPath, hmrDelayThreshold = 1000, trimQueryParams }: PluginConf = {}) => {
    let hub: Hub
    const trimParams = new Set([...(trimQueryParams ?? []), 'v', 't', 'sentry-auto-wrap'])
    return {
        name: pluginName,
        async configResolved(config: { env: { DEV?: boolean } }) {
            hub = await Hub.create(
                config.env.DEV ? 'dev' : 'build',
                () => getConfig(configPath),
                dirname(configPath ?? '.'),
                hmrDelayThreshold,
                undefined,
                toViteError,
            )
        },
        async handleHotUpdate(ctx: HotUpdateCtx) {
            const changeInfo = await hub.onFileChange(ctx.file, ctx.read)
            if (!changeInfo) {
                return
            }
            const invalidatedModules = new Set()
            for (const fileID of changeInfo.invalidate ?? []) {
                for (const module of ctx.server.moduleGraph.getModulesByFile(fileID) ?? []) {
                    ctx.server.moduleGraph.invalidateModule(module, invalidatedModules, ctx.timestamp, false)
                }
            }
            if (!changeInfo.sourceTriggered && changeInfo.invalidate.size > 0) {
                ctx.server.ws.send({ type: 'full-reload' })
            }
            return []
        },
        transform: {
            order: 'pre' as const,
            async handler(code: string, id: string, options?: { ssr?: boolean | undefined }) {
                const [output] = await hub.transform(code, trimViteQueries(id, trimParams), options?.ssr)
                return output
            },
        },
    }
}
