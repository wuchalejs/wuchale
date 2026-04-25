import { loadLocales } from 'wuchale/load-utils/server'
import { locales } from '${DATA}'
import { loadCatalog, nLoadIDs } from '${PROXY_SYNC}'

export { loadCatalog, nLoadIDs }
export const key = '${KEY}'

// two exports
export const getRuntime = await loadLocales(key, nLoadIDs, loadCatalog, locales)
export const getRuntimeRx = getRuntime
