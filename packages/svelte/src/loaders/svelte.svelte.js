import { defaultCollection, registerLoaders } from 'wuchale/load-utils'
import { loadCatalog, loadIDs } from '${PROXY}'

const key = '${KEY}'

const runtimes = $state({})

// for non-reactive
export const getRuntime = registerLoaders(key, loadCatalog, loadIDs, defaultCollection(runtimes))

// same function, only will be inside $derived when used
export const getRuntimeRx = getRuntime
