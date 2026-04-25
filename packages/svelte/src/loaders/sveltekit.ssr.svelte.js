import { currentRuntime } from 'wuchale/load-utils/server'
import { loadCatalog, nLoadIDs } from '${PROXY_SYNC}'

const key = '${KEY}'

export { key, loadCatalog, nLoadIDs } // for hooks.server.{js,ts}

// for non-reactive
export const getRuntime = (loadID = 0) => currentRuntime(key, loadID)

// same function, only will be inside $derived when used
export const getRuntimeRx = getRuntime
