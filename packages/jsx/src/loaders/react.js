// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { loadCatalog, loadIDs, key } from 'virtual:wuchale/proxy' // or proxy/sync
import { registerLoaders } from 'wuchale/load-utils'
import { Runtime } from 'wuchale/runtime'
import { useState, useEffect } from 'react'

const callbacks = {}

const collection = {
    get: () => null, // not needed, using useState
    set: (loadID, catalog) => {
        callbacks[loadID]?.(catalog)
    }
}

registerLoaders(key, loadCatalog, loadIDs, collection)

export default loadID => {
    const [runtime, setRuntime] = useState(new Runtime())
    useEffect(() => {
        callbacks[loadID] = catalog => setRuntime(new Runtime(catalog))
    })
    return runtime
}
