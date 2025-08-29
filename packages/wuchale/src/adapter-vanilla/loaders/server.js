// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

import { loadCatalog, loadIDs, key } from './proxy.js'
import { loadLocales } from 'wuchale/load-utils/server'

// two exports
export const get = await loadLocales(key, loadIDs, loadCatalog, ['en'])
export default get
