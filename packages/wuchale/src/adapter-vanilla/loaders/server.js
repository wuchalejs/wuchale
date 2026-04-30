import { loadLocales } from 'wuchale/load-utils/server'
import { locales } from '${DATA}'
import { loadCatalog, loadCount } from '${PROXY_SYNC}'

export { loadCatalog, loadCount }
export const key = '${KEY}'

// two exports
export const getRuntime = await loadLocales(key, loadCount, loadCatalog, locales)
export const getRuntimeRx = getRuntime
