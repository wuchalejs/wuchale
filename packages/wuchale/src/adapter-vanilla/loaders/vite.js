import { registerLoaders } from 'wuchale/load-utils'
import { loadCatalog, nLoadIDs } from '${PROXY}'

const key = '${KEY}'

// two exports. can be used anywhere
export const getRuntime = registerLoaders(key, loadCatalog, nLoadIDs)
export const getRuntimeRx = getRuntime
