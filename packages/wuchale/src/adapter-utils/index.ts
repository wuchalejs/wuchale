export { MixedVisitor } from './mixed-visitor.js'

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HeuristicResultChecked } from '../adapters.js'

export const varNames = {
    rt: '_w_runtime_',
    hmrUpdate: '_w_hmrUpdate_',
    urlLocalize: '_w_localize_',
}

export function runtimeVars(wrapFunc: (expr: string) => string, base = varNames.rt) {
    return {
        rtTrans: `${wrapFunc(base)}`,
        rtTPlural: `${wrapFunc(base)}.p`,
        rtPlural: `${wrapFunc(base)}._.p`,
        rtLocale: `${wrapFunc(base)}.l`,
        rtCtx: `${wrapFunc(base)}.c`,
        rtTransCtx: `${wrapFunc(base)}.x`,
        rtTransTag: `${wrapFunc(base)}.t`,
        /** for when nesting, used in adapters with elements */
        nestCtx: '_w_ctx_',
    }
}

export type RuntimeVars = ReturnType<typeof runtimeVars>

export function nonWhitespaceText(msgStr: string): [number, string, number] {
    const trimmedS = msgStr.trimStart()
    const startWh = msgStr.length - trimmedS.length
    const trimmed = trimmedS.trimEnd()
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
    unit: `${commentPrefix}unit`,
    url: `${commentPrefix}url`,
    context: `${commentPrefix}context:`,
}

export type CommentDirectives = {
    ignoreFile?: boolean
    unit?: boolean
    forceType?: HeuristicResultChecked
    context?: string
}

export function updateCommentDirectives(data: string, directives: CommentDirectives) {
    if (data === commentDirectives.include) {
        directives.forceType = 'message'
    }
    if (data === commentDirectives.url) {
        directives.forceType = 'url'
    }
    if (data === commentDirectives.unit) {
        directives.unit = true
    }
    if (data === commentDirectives.ignore) {
        directives.forceType = false
    }
    if (data === commentDirectives.ignoreFile) {
        directives.ignoreFile = true
    }
    if (data.startsWith(commentDirectives.context)) {
        directives.context = data.slice(commentDirectives.context.length).trim()
    }
}
