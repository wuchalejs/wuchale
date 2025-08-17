import type { Mixed, CompiledElement } from "./compile.js"

export const catalogVarName = 'c' as 'c'
type PluralsRule = (n: number) => number
export type CatalogModule = {
    [catalogVarName]: CompiledElement[],
    p: PluralsRule,
    onUpdate?: (callback: (newData: CompiledElement[]) => void) => void
}

export const defaultPluralsRule: PluralsRule = n => n === 1 ? 0 : 1
export function defaultErr(id: number, ctx: CompiledElement): string {
    if (ctx == null) {
        return `[i18n-404:${id}]`
    }
    return `[i18n-400:${id}(${ctx})]`
}

let err = defaultErr

export class Runtime {

    _: CatalogModule = { c: [], p: defaultPluralsRule }

    static setErrMsg = (e: typeof err) => { err = e }

    constructor(module?: CatalogModule) {
        if (!module) { // for fallback
            return
        }
        this._ = module
    }

    /** get composite context */
    cx = (id: number) => {
        const ctx = this._.c[id]
        if (typeof ctx === 'string') {
            return [ctx]
        }
        if (Array.isArray(ctx)) {
            return ctx
        }
        return [err(id, ctx)]
    }

    /** get translation using composite context */
    tx = (ctx: Mixed, args: any[] = [], start = 1) => {
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

    /** get translation for plural */
    tp = (id: number) => this._.c[id] ?? []

    /** get translation */
    t = (id: number, args: any[] = []) => this.tx(this.cx(id) as Mixed, args, 0)
}
