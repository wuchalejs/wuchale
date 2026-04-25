// Astro loader template (server-side, synchronous)
// This is a template file that wuchale will use to generate the actual loader

import { currentRuntime } from 'wuchale/load-utils/server'
import { loadCatalog, patterns } from '${PROXY_SYNC}'

const key = '${KEY}'

export { key, loadCatalog, patterns }

// For non-reactive server-side rendering
export const getRuntime = (loadID = 0) => currentRuntime(key, loadID)

// Same function for compatibility
export const getRuntimeRx = getRuntime
