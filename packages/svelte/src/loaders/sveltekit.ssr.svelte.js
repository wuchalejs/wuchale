// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

import { loadCatalog, loadIDs } from '${PROXY_SYNC}'
import { currentRuntime } from 'wuchale/load-utils/server'

const key = '${KEY}'

export { loadCatalog, loadIDs, key } // for hooks.server.{js,ts}

// for non-reactive
export const getRuntime = (/** @type {string} */ loadID) => currentRuntime(key, loadID)

// same function, only will be inside $derived when used
export const getRuntimeRx = getRuntime
