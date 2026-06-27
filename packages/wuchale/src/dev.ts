import type { CompiledElement } from './compile.js'
import type { Runtime } from './runtime.js'
import toRuntime from './runtime.js'

type GetRuntime = (loadID: number) => Runtime

export type HMRData = Record<string, [number, CompiledElement][]>

function updatedFunc(getRuntime: GetRuntime, data: HMRData): GetRuntime {
    return loadID => {
        const rt = getRuntime(loadID)
        const newItems: CompiledElement[] = [...rt._.c]
        for (const [index, item] of data[rt.l] ?? []) {
            newItems[index] = item
        }
        return toRuntime(rt.l, { c: newItems, p: rt._.p })
    }
}

export function updated(getRuntime: GetRuntime, getRuntimeRx: GetRuntime, data: HMRData): [GetRuntime, GetRuntime] {
    return [updatedFunc(getRuntime, data), updatedFunc(getRuntimeRx, data)]
}
