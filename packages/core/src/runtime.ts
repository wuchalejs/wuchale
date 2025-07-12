type Composite = (number | string | Composite)[]
type TranslationsData = (string | Composite)[]
type PluralsRule = (n: number) => number

export type TranslationsModule = {
    default: TranslationsData
    pluralsRule: PluralsRule
}

export class RunTime {

    data: TranslationsData = []
    pr: PluralsRule = n => n === 1 ? 0 : 1

    constructor(module: TranslationsModule) {
        this.data = module.default
        this.pr = module.pluralsRule ?? this.pr
    }

    /** get composite context */
    cx(id: number) {
        const ctx = this.data[id]
        if (typeof ctx === 'string') {
            return [ctx]
        }
        if (ctx == null || typeof ctx === 'number') {
            return [`[i18n-404:${id}(${ctx})]`]
        }
        return ctx
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

export const _wr_: Map<string, RunTime> = new Map()

export function setTranslations(mod: TranslationsModule, key: string | number = 0) {
    _wr_[key] = new RunTime(mod)
}
