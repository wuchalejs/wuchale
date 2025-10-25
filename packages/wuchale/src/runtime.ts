import type { Mixed, CompiledElement, Composite } from "./compile.js"

export const catalogVarName = 'c' as 'c'
export type CatalogModule = {
    [catalogVarName]: CompiledElement[]
    p?: (n: number) => number
    update?: (callback: (newData: CompiledElement[]) => void) => void
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

export type Runtime = {
    _: CatalogModule;
    l: string;
    cx: (id: number) => Mixed | Composite;
    tx: (ctx: Mixed, args?: any[], start?: number) => string;
    tt: (tag: CallableFunction, id: number, args?: any[]) => any;
    tp: (id: number) => any;
    t: (id: number, args?: any[]) => any;
}

/** get translation using composite context */
function mixedToString(ctx: Mixed, args: any[] = [], start = 1) {
    let msgStr = ''
    for (let i = start; i < ctx.length; i++) {
        const fragment = ctx[i]
        if (typeof fragment === 'string') {
            msgStr += fragment
        } else { // index of non-text children
            msgStr += args[fragment]
        }
    }
    return msgStr
}

// Can't make it a class because reactivity is lost on svelte and possibly others too
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

    return {
        _: mod,
        l: locale,
        cx: getCompositeContext,
        tx: mixedToString,

        /** for tagged template strings */
        tt: (tag: CallableFunction, id: number, args?: any[]) => {
            const ctx = getCompositeContext(id) as Mixed
            return tag(
                ctx.filter(m => typeof m === 'string'),
                ...ctx.filter(m => typeof m === 'number').map(a => args?.[a])
            )
        },

        /** get translation for plural */
        tp: (id: number) => catalog[id] ?? [],

        /** get translation */
        t: (id: number, args: any[] = []) => mixedToString(getCompositeContext(id) as Mixed, args, 0)
    }
}
