import { dirname } from 'node:path'
import { getConfig } from 'wuchale'
import { Hub, pluginName } from '../hub.js'

export function toViteError(err: any, adapterKey: string, filename: string): Error {
    const prefix = `${adapterKey}: transform failed for ${filename}`
    // Ensure we always throw an Error instance with a non-empty message so build tools (e.g. Vite)
    // don't end up printing only a generic "error during build:" line.
    const frame: string | undefined = typeof err.frame === 'string' ? err.frame : undefined
    if (!err.message || !err.message.startsWith(prefix)) {
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

export function trimViteQueries(id: string) {
    let queryIndex = id.indexOf('?v=')
    if (queryIndex === -1) {
        queryIndex = id.indexOf('?t=')
    }
    if (queryIndex >= 0 && !id.includes('&', queryIndex)) {
        // trim after this, like ?v=b65b2c3b when it's from node_modules
        id = id.slice(0, queryIndex)
    }
    return id
}

type HotUpdateCtx = {
    file: string
    server: {
        ws: { send: Function }
        moduleGraph: {
            getModulesByFile: Function
            invalidateModule: Function
        }
    }
    read: () => string | Promise<string>
    timestamp: number
}

export const wuchale = (configPath?: string, hmrDelayThreshold = 1000) => {
    const hub = new Hub(
        () => getConfig(configPath),
        dirname(configPath ?? '.'),
        hmrDelayThreshold,
        undefined,
        toViteError,
    )
    return {
        name: pluginName,
        async configResolved(config: { env: { DEV?: boolean } }) {
            await hub.init(config.env.DEV ? 'dev' : 'build')
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
                return []
            }
        },
        transform: {
            order: 'pre' as const,
            async handler(code: string, id: string, options?: { ssr?: boolean | undefined }) {
                const [output] = await hub.transform(code, trimViteQueries(id), options?.ssr)
                return output
            },
        },
    }
}
