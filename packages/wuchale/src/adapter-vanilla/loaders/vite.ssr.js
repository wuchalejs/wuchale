import { currentRuntime } from 'wuchale/load-utils/server'
import { loadCatalog, loadIDs } from '${PROXY_SYNC}'

export const key = '${KEY}'
export { loadCatalog, loadIDs } // for loading before runWithLocale

// two exports, same function
export const getRuntime = (/** @type {string} */ loadID) => currentRuntime(key, loadID)
export const getRuntimeRx = getRuntime
