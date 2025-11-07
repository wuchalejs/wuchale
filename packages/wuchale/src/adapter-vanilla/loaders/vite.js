import { loadCatalog, loadIDs } from '${PROXY}'
import { registerLoaders } from 'wuchale/load-utils'

const key = '${KEY}'

// two exports. can be used anywhere
export const getRuntime = registerLoaders(key, loadCatalog, loadIDs)
export const getRuntimeRx = getRuntime
