// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

import { loadCatalog, loadIDs } from '${PROXY}'
import { registerLoaders } from 'wuchale/load-utils'
import { useState, useEffect } from 'react'

const key = '${KEY}'
const callbacks = {}
const store = {}

// non-reactive
export const getRuntime = (/** @type {string} */ loadID) => store[loadID]

const collection = {
    get: getRuntime,
    set: (/** @type {string} */ loadID, /** @type {import('wuchale/runtime').Runtime} */ runtime) => {
        store[loadID] = runtime // for when useEffect hasn't run yet
        callbacks[loadID]?.(runtime)
    }
}

registerLoaders(key, loadCatalog, loadIDs, collection)

export const getRuntimeRx = (/** @type {string} */ loadID) => {
    const [runtime, setRuntime] = useState(collection.get(loadID))
    useEffect(() => {
        callbacks[loadID] = (/** @type {import('wuchale/runtime').Runtime} */ runtime) => setRuntime(runtime)
        return () => delete callbacks[loadID]
    }, [loadID])
    return runtime
}
