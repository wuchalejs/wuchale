let translations = $state({})

type Composite = (number | string | Composite)[]

export function setTranslations(transArray: (string | Composite)[]) {
    translations = transArray
}

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

export function wuchaleTrans(id: number, ...args: string[]) {
    const ctx = getCtx(id)
    let txt = ''
    for (const fragment of ctx) {
        if (typeof fragment === 'string') {
            txt += fragment
        } else if (typeof fragment === 'number') { // index of non-text children
            txt += args[fragment]
        } else {
            // shouldn't happen
            console.error('Unknown item in compiled catalog: ', id, fragment)
        }
    }
    return txt
}
