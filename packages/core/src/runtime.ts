type Composite = (number | string | Composite)[]
type PluralsRule = (n: number) => number

const defaultPluralsRule: PluralsRule = n => n === 1 ? 0 : 1

let translations: (string | Composite)[] = []
let pluralsRule = defaultPluralsRule

export function setTranslations(mod: {default: (string | Composite)[], pluralsRule: PluralsRule}) {
    translations = mod.default
    pluralsRule = mod.pluralsRule ?? pluralsRule
}

export const wuchalePluralsRule = () => pluralsRule

export function getCtx(id: number) {
    const ctx = translations[id]
    if (typeof ctx === 'string') {
        return [ctx]
    }
    if (ctx == null || typeof ctx === 'number') {
        return [`[i18n-404:${id}(${ctx})]`]
    }
    return ctx
}

export function wuchaleTransCtx(ctx: Composite, args: any[] = [], start = 1) {
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

export function wuchaleTransPlural(id: number) {
    return translations[id] ?? []
}

export function wuchaleTrans(id: number, args: any[] = []) {
    return wuchaleTransCtx(getCtx(id), args, 0)
}
