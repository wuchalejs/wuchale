
// for runtime
const rtConst = '_w_runtime_'
export const varNames = {
    rtConst,
    rtTrans: `${rtConst}.t`,
    rtTPlural: `${rtConst}.tp`,
    rtPlural: `${rtConst}._.p`,
    rtCtx: `${rtConst}.cx`,
    rtTransCtx: `${rtConst}.tx`,
    /** for when nesting, used in adapters with elements */
    nestCtx: '_w_ctx_',
}

export function nonWhitespaceText(text: string): [number, string, number] {
    let trimmedS = text.trimStart()
    const startWh = text.length - trimmedS.length
    let trimmed = trimmedS.trimEnd()
    const endWh = trimmedS.length - trimmed.length
    return [startWh, trimmed, endWh]
}
