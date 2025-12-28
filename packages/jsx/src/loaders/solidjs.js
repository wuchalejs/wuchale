import { loadCatalog, loadIDs } from '${PROXY}'
import { registerLoaders } from 'wuchale/load-utils'
import { createStore } from 'solid-js/store'

const key = '${KEY}'

const [store, setStore] = createStore({})

// two exports. can be the same because solid-js can use them anywhere unlike react
export const getRuntimeRx = registerLoaders(key, loadCatalog, loadIDs, {
    get: loadID => store[loadID],
    set: (loadID, runtime) => setStore(loadID, () => runtime),
})
export const getRuntime = getRuntimeRx
