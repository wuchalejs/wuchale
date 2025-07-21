// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists and is not empty.

// NOTE: if you use-per file loading, HMR for THIS file will not work
// because this file will just be used as a template, not imported directly.
// If you make a change, restart the dev server.

/// <reference types="wuchale/virtual" />

import { Runtime } from 'wuchale/runtime'
import { loadCatalog, fileID } from 'virtual:wuchale/loader' // or loader/sync
import { registerLoader } from 'wuchale/run-client'

const catalog = $state({ current: new Runtime() })

let getCatalog = registerLoader('thisgroup', fileID, catalog, loadCatalog)

if (import.meta.env.SSR) { // stripped for the client
    const { registerLoader } = await import('wuchale/run-server')
    const { loadCatalog } = await import('virtual:wuchale/loader/sync')
    getCatalog = registerLoader(fileID, loadCatalog)
}

export default getCatalog
