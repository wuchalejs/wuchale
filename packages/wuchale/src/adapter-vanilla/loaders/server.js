import { loadCatalog, loadIDs } from '${PROXY_SYNC}'
import { locales } from '${DATA}'
import { loadLocales } from 'wuchale/load-utils/server'

export { loadIDs, loadCatalog }
export const key = '${KEY}'

// two exports
export const getRuntime = await loadLocales(key, loadIDs, loadCatalog, locales)
export const getRuntimeRx = getRuntime
