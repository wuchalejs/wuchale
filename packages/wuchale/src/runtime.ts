import type { Mixed, CompiledElement } from "./compile.js"

export const catalogVarName = 'c' as 'c'
export type CatalogModule = {
    [catalogVarName]: CompiledElement[]
    p?: (n: number) => number
    l?: string
    onUpdate?: (callback: (newData: CompiledElement[]) => void) => void
}

let onInvalid: (i: number, c: CompiledElement[]) => string = () => ''

// @ts-expect-error
if (import.meta.env?.DEV) {
    onInvalid = (i, c) => {
        const item = c[i]
        if (item == null) {
            return `[i18n-404:${i}]`
        }
        return `[i18n-400:${i}(${item})]`
    }
}

export class Runtime {

    _: CatalogModule = { c: [] }

    static onInvalid = (newOnInvalid: typeof onInvalid) => { onInvalid = newOnInvalid }

    constructor(module?: CatalogModule) {
        if (!module) { // for fallback
            return
        }
        this._ = module
    }

    /** get composite context */
    cx = (id: number) => {
        const ctx: CompiledElement = this._.c[id]
        if (typeof ctx === 'string') {
            return [ctx]
        }
        if (Array.isArray(ctx)) {
            return ctx
        }
        return [onInvalid(id, this._.c)]
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

    /** for tagged template strings */
    tt = (tag: CallableFunction, id: number, args?: any[]) => {
        const ctx = this.cx(id) as Mixed
        return tag(
            ctx.filter(m => typeof m === 'string'),
            ...ctx.filter(m => typeof m === 'number').map(a => args?.[a])
        )
    }

    /** get translation for plural */
    tp = (id: number) => this._.c[id] ?? []

    /** get translation */
    t = (id: number, args: any[] = []) => this.tx(this.cx(id) as Mixed, args, 0)
}

export default (catalog: CatalogModule) => new Runtime(catalog)
