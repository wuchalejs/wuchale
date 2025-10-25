export { MixedVisitor } from './mixed-visitor.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const varNames = {
    rt: '_w_runtime_',
    hmrUpdate: '_w_hmrUpdate_',
}

export function runtimeVars(wrapFunc: (expr: string) => string, base = varNames.rt) {
    return {
        rtTrans: `${wrapFunc(base)}.t`,
        rtTPlural: `${wrapFunc(base)}.tp`,
        rtPlural: `${wrapFunc(base)}._.p`,
        rtLocale: `${wrapFunc(base)}.l`,
        rtCtx: `${wrapFunc(base)}.cx`,
        rtTransCtx: `${wrapFunc(base)}.tx`,
        rtTransTag: `${wrapFunc(base)}.tt`,
        /** for when nesting, used in adapters with elements */
        nestCtx: '_w_ctx_',
    }
}

export type RuntimeVars = ReturnType<typeof runtimeVars>

export function nonWhitespaceText(msgStr: string): [number, string, number] {
    let trimmedS = msgStr.trimStart()
    const startWh = msgStr.length - trimmedS.length
    let trimmed = trimmedS.trimEnd()
    const endWh = trimmedS.length - trimmed.length
    return [startWh, trimmed, endWh]
}

export function loaderPathResolver(importMetaUrl: string, baseDir: string, ext: string) {
    const dir = dirname(fileURLToPath(importMetaUrl))
    return (name: string) => resolve(dir, `${baseDir}/${name}.${ext}`)
}

export const commentPrefix = '@wc-'

const commentDirectives = {
    ignore: `${commentPrefix}ignore`,
    ignoreFile: `${commentPrefix}ignore-file`,
    include: `${commentPrefix}include`,
    context: `${commentPrefix}context:`,
}

export type CommentDirectives = {
    ignoreFile?: boolean
    forceInclude?: boolean
    context?: string
}

export function processCommentDirectives(data: string, current: CommentDirectives) {
    const directives: CommentDirectives = {...current}
    if (data === commentDirectives.ignore) {
        directives.forceInclude = false
    }
    if (data === commentDirectives.include) {
        directives.forceInclude = true
    }
    if (data === commentDirectives.ignoreFile) {
        directives.ignoreFile = true
    }
    if (data.startsWith(commentDirectives.context)) {
        directives.context = data.slice(commentDirectives.context.length).trim()
    }
    return directives
}
