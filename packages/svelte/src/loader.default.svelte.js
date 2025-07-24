// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

/// <reference types="wuchale/virtual" />

import { loadCatalog, fileIDs } from 'virtual:wuchale/loader' // or /loader/sync
import { registerLoader } from 'wuchale/run-client'

const catalogs = $state({})

export default registerLoader('main', fileIDs, loadCatalog, catalogs)
