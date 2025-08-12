
// for runtime
const rtConst = '_w_runtime_'

export function runtimeVars(wrapFunc: (expr: string) => string) {
    return {
        rtConst,
        rtTrans: `${wrapFunc(rtConst)}.t`,
        rtTPlural: `${wrapFunc(rtConst)}.tp`,
        rtPlural: `${wrapFunc(rtConst)}._.p`,
        rtCtx: `${wrapFunc(rtConst)}.cx`,
        rtTransCtx: `${wrapFunc(rtConst)}.tx`,
        /** for when nesting, used in adapters with elements */
        nestCtx: '_w_ctx_',
    }
}

export type RuntimeVars = ReturnType<typeof runtimeVars>

export function nonWhitespaceText(text: string): [number, string, number] {
    let trimmedS = text.trimStart()
    const startWh = text.length - trimmedS.length
    let trimmed = trimmedS.trimEnd()
    const endWh = trimmedS.length - trimmed.length
    return [startWh, trimmed, endWh]
}
