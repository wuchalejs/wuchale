import { registerLoaders } from 'wuchale/load-utils'
import { loadCatalog, loadCount } from '${PROXY}'

const key = '${KEY}'

// two exports. can be used anywhere
export const getRuntime = registerLoaders(key, loadCatalog, loadCount)
export const getRuntimeRx = getRuntime
