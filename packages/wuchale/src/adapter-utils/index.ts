import { readFile } from "node:fs/promises"
export { MixedVisitor } from './mixed-visitor.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const varNames = {
    rt: '_w_runtime_',
    hmrUpdate: '_w_hmrUpdate_',
    rtWrap: '_w_to_rt_',
}

export function runtimeVars(wrapFunc: (expr: string) => string, base = varNames.rt) {
    return {
        rtTrans: `${wrapFunc(base)}.t`,
        rtTPlural: `${wrapFunc(base)}.tp`,
        rtPlural: `${wrapFunc(base)}._.p`,
        rtCtx: `${wrapFunc(base)}.cx`,
        rtTransCtx: `${wrapFunc(base)}.tx`,
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

export function loaderPathResolver(importMetaUrl: string, baseDir: string, ext: string) {
    const dir = dirname(fileURLToPath(importMetaUrl))
    return (name: string) => resolve(dir, `${baseDir}/${name}.${ext}`)
}
