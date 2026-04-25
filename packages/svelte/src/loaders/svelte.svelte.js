import { defaultCollection, registerLoaders } from 'wuchale/load-utils'
import { loadCatalog, nLoadIDs } from '${PROXY}'

const key = '${KEY}'

/** @type import('wuchale/runtime').Runtime[] */
const runtimes = $state([])

// for non-reactive
export const getRuntime = registerLoaders(key, loadCatalog, nLoadIDs, defaultCollection(runtimes))

// same function, only will be inside $derived when used
export const getRuntimeRx = getRuntime
