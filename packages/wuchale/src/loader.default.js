// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

import { loadCatalog, loadIDs } from './proxy.js' // or loader/sync
import { loadLocales } from 'wuchale/run-server'

export default await loadLocales('main', loadIDs, loadCatalog, ['en'])
