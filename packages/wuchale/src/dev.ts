import type { CompiledElement } from './compile.js'
import type { Runtime } from './runtime.js'
import toRuntime from './runtime.js'

type GetRuntime = (loadID: number) => Runtime

export type HMRData = Record<string, [number, CompiledElement][]>

function updatedFunc(getRuntime: GetRuntime, data: HMRData, version: number): GetRuntime {
    return loadID => {
        const rt = getRuntime(loadID)
        if (rt._.v != null && rt._.v >= version) {
            return rt
        }
        const newItems: CompiledElement[] = [...rt._.c]
        for (const [index, item] of data[rt.l] ?? []) {
            newItems[index] = item
        }
        return toRuntime({ c: newItems }, rt.l)
    }
}

export function updated(
    getRuntime: GetRuntime,
    getRuntimeRx: GetRuntime,
    data: HMRData,
    version: number,
): [GetRuntime, GetRuntime] {
    return [updatedFunc(getRuntime, data, version), updatedFunc(getRuntimeRx, data, version)]
}
