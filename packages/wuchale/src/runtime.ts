type Composite = (number | string | Composite)[]
type CompiledData = (string | Composite)[]
type PluralsRule = (n: number) => number

export type CatalogModule = {
    data: CompiledData
    plural: PluralsRule
}

export class Runtime {

    data: CompiledData = []
    pr: PluralsRule = n => n === 1 ? 0 : 1

    constructor(module?: CatalogModule) {
        if (!module) { // for fallback
            return
        }
        this.data = module.data
        this.pr = module.plural ?? this.pr
    }

    /** get composite context */
    cx(id: number) {
        const ctx = this.data[id]
        if (typeof ctx === 'string') {
            return [ctx]
        }
        if (Array.isArray(ctx)) {
            return ctx
        }
        if (ctx == null) {
            return [`[i18n-404:${id}]`]
        }
        return [`[i18n-400:${id}(${ctx})]`]
    }

    /** get translation using composite context */
    tx(ctx: Composite, args: any[] = [], start = 1) {
        let txt = ''
        for (let i = start; i < ctx.length; i++) {
            const fragment = ctx[i]
            if (typeof fragment === 'string') {
                txt += fragment
            } else if (typeof fragment === 'number') { // index of non-text children
                txt += args[fragment]
            } else {
                // shouldn't happen
                console.error('Unknown item in compiled catalog: ', fragment)
            }
        }
        return txt
    }

    /** get translation for plural */
    tp(id: number) {
        return this.data[id] ?? []
    }

    /** get translation */
    t(id: number, args: any[] = []) {
        return this.tx(this.cx(id), args, 0)
    }
}
