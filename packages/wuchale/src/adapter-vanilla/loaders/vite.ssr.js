import { currentRuntime } from 'wuchale/load-utils/server'
import { loadCatalog, loadCount } from '${PROXY_SYNC}'

export const key = '${KEY}'
export { loadCatalog, loadCount } // for loading before runWithLocale

// two exports, same function
export const getRuntime = (loadID = 0) => currentRuntime(key, loadID)
export const getRuntimeRx = getRuntime
