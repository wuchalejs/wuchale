// This is just the default loader.
// You can customize it however you want, it will not be overwritten once it exists.

import { loadCatalog } from 'virtual:wuchale/loader' // or loader/sync

export default registerLoader('thisgroup', null, catalog, loadCatalog)
