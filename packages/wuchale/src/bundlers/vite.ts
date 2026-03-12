import { dirname } from 'node:path'
import { inspect } from 'node:util'
import { getConfig } from 'wuchale'
import { Hub, pluginName } from '../hub.js'

export function toViteError(err: unknown, adapterKey: string, filename: string): never {
    const prefix = `${adapterKey}: transform failed for ${filename}`
    // Ensure we always throw an Error instance with a non-empty message so build tools (e.g. Vite)
    // don't end up printing only a generic "error during build:" line.
    if (err instanceof Error) {
        const anyErr = err as any
        const frame: string | undefined = typeof anyErr.frame === 'string' ? anyErr.frame : undefined
        if (!err.message || !err.message.startsWith(prefix)) {
            const details = err.message ? `\n${err.message}` : ''
            const frameText = frame ? `\n\n${frame}` : ''
            err.message = `${prefix}${details}${frameText}`
        }
        // Preserve useful metadata that some tooling expects.
        if (anyErr.id == null) anyErr.id = filename
        if (anyErr.loc == null && anyErr.start?.line != null && anyErr.start?.column != null) {
            anyErr.loc = { file: filename, line: anyErr.start.line, column: anyErr.start.column }
        }
        throw err
    }
    const rendered =
        typeof err === 'string' ? err : inspect(err, { depth: 5, breakLength: 120, maxStringLength: 10_000 })
    throw new Error(`${prefix}\n${rendered}`)
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
    const hub = new Hub(() => getConfig(configPath), dirname(configPath ?? '.'), hmrDelayThreshold)
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
            if (!changeInfo.sourceTriggered) {
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
