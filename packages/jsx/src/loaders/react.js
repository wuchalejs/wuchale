// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { loadCatalog, loadIDs, key } from 'virtual:wuchale/proxy' // or proxy/sync
import { registerLoaders } from 'wuchale/load-utils/client'
import { Runtime } from 'wuchale/runtime'
import { useState, useEffect } from 'react'

const listeners = {}

const collection = {
    get: () => null, // not needed, using useState
    set: (loadID, catalog) => {
        listeners[loadID]?.(catalog)
    }
}

registerLoaders(key, loadCatalog, loadIDs, collection)

export default loadID => {
    const [runtime, setRuntime] = useState(new Runtime())
    useEffect(() => {
        listeners[loadID] = catalog => setRuntime(new Runtime(catalog))
    })
    return runtime
}
