import type { CompiledElement, CompositePayload, Mixed } from './compile.js'

export const catalogVarName = 'c' as 'c'
export type CatalogModule = {
    [catalogVarName]: CompiledElement[]
    p?: (n: number) => number
    update?: Function
}

let onInvalidFunc: (i: number, c: CompiledElement[]) => string = () => ''

// @ts-expect-error
if (import.meta.env?.DEV) {
    onInvalidFunc = (i, c) => {
        const item = c[i]
        if (item == null) {
            return `[i18n-404:${i}]`
        }
        return `[i18n-400:${i}(${item})]`
    }
}

export function onInvalid(newOnInvalid: typeof onInvalidFunc) {
    onInvalidFunc = newOnInvalid
}

// using pre-minified methods
export type Runtime = {
    _: CatalogModule
    l?: string
    c: (id: number) => Mixed | CompositePayload[] // composite context
    x: (ctx: Mixed, args?: any[], start?: number) => string // mixed to string
    t: (tag: CallableFunction, id: number, args?: any[]) => any // tagged template
    p: (id: number) => any // plural text
    (id: number, args?: any[]): any // most frequent use as direct call
}

/** get translation using composite context */
function mixedToString(ctx: Mixed, args: any[] = [], start = 1) {
    let msgStr = ''
    for (let i = start; i < ctx.length; i++) {
        const fragment = ctx[i]
        if (typeof fragment === 'string') {
            msgStr += fragment
        } else {
            // index of non-text children
            msgStr += args[fragment]
        }
    }
    return msgStr
}

export default function toRuntime(mod: CatalogModule = { [catalogVarName]: [] }, locale?: string): Runtime {
    const catalog = mod[catalogVarName]

    /** get composite context */
    const getCompositeContext = (id: number) => {
        const ctx: CompiledElement = catalog[id]
        if (typeof ctx == 'string') {
            return [ctx]
        }
        if (Array.isArray(ctx)) {
            return ctx
        }
        return [onInvalidFunc(id, catalog)]
    }

    const rt: Runtime = (id: number, args: any[] = []) => mixedToString(getCompositeContext(id) as Mixed, args, 0)

    rt._ = mod
    rt.l = locale
    rt.c = getCompositeContext
    rt.x = mixedToString

    /** for tagged template strings */
    rt.t = (tag: CallableFunction, id: number, args?: any[]) => {
        const ctx = getCompositeContext(id) as Mixed
        return tag(
            ctx.filter(m => typeof m === 'string'),
            ...ctx.filter(m => typeof m === 'number').map(a => args?.[a]),
        )
    }

    /** get translation for plural */
    rt.p = (id: number) => catalog[id] ?? []

    return rt
}
