import { currentRuntime } from 'wuchale/load-utils/server'
import { loadCatalog, nLoadIDs } from '${PROXY_SYNC}'

export const key = '${KEY}'
export { loadCatalog, nLoadIDs } // for loading before runWithLocale

// two exports, same function
export const getRuntime = (loadID = 0) => currentRuntime(key, loadID)
export const getRuntimeRx = getRuntime
