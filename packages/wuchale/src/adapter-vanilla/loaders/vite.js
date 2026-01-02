import { registerLoaders } from 'wuchale/load-utils'
import { loadCatalog, loadIDs } from '${PROXY}'

const key = '${KEY}'

// two exports. can be used anywhere
export const getRuntime = registerLoaders(key, loadCatalog, loadIDs)
export const getRuntimeRx = getRuntime
