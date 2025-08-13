// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { loadCatalog, loadIDs, key } from 'virtual:wuchale/proxy' // or proxy/sync
import { registerLoaders } from 'wuchale/load-utils'
import { createStore } from 'solid-js/store'

const [store, setStore] = createStore({})

export default registerLoaders(key, loadCatalog, loadIDs, {
    get: loadID => store[loadID],
    set: setStore,
})
