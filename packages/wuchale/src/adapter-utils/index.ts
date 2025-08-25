import { readFile } from "node:fs/promises"
export { MixedVisitor, type MixedScope } from './mixed-visitor.js'

// for runtime
const rtConst = '_w_runtime_'

export const runtimeVars = {
    hmrUpdate: '_w_hmrUpdate_',
    rtWrap: '_w_to_rt_',
    rtConst,
    rtTrans: `${rtConst}.t`,
    rtTPlural: `${rtConst}.tp`,
    rtPlural: `${rtConst}._.p`,
    rtCtx: `${rtConst}.cx`,
    rtTransCtx: `${rtConst}.tx`,
    /** for when nesting, used in adapters with elements */
    nestCtx: '_w_ctx_',
}

export function nonWhitespaceText(msgStr: string): [number, string, number] {
    let trimmedS = msgStr.trimStart()
    const startWh = msgStr.length - trimmedS.length
    let trimmed = trimmedS.trimEnd()
    const endWh = trimmedS.length - trimmed.length
    return [startWh, trimmed, endWh]
}

export async function getDependencies() {
    let json = { devDependencies: {}, dependencies: {} }
    try {
        const pkgJson = await readFile('package.json')
        json = JSON.parse(pkgJson.toString())
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err
        }
    }
    return new Set(Object.keys({ ...json.devDependencies, ...json.dependencies }))
}
