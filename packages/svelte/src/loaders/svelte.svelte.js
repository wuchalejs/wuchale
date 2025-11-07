import { loadCatalog, loadIDs } from '${PROXY}'
import { registerLoaders, defaultCollection } from 'wuchale/load-utils'

const key = '${KEY}'

const runtimes = $state({})

// for non-reactive
export const getRuntime = registerLoaders(key, loadCatalog, loadIDs, defaultCollection(runtimes))

// same function, only will be inside $derived when used
export const getRuntimeRx = getRuntime
