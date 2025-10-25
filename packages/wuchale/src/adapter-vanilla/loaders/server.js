// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

import { loadCatalog, loadIDs } from '${PROXY_SYNC}'
import { locales } from '${DATA}'
import { loadLocales } from 'wuchale/load-utils/server'

export const key = '${KEY}'

// two exports
export const getRuntime = await loadLocales(key, loadIDs, loadCatalog, locales)
export const getRuntimeRx = getRuntime
