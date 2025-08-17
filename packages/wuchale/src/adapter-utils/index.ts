import { readFile } from "node:fs/promises"
export { MixedVisitor } from './mixed-visitor.js'

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
