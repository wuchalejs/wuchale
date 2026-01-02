import { loadLocales } from 'wuchale/load-utils/server'
import { locales } from '${DATA}'
import { loadCatalog, loadIDs } from '${PROXY_SYNC}'

export { loadIDs, loadCatalog }
export const key = '${KEY}'

// two exports
export const getRuntime = await loadLocales(key, loadIDs, loadCatalog, locales)
export const getRuntimeRx = getRuntime
