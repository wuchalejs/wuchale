---
"wuchale": minor
---

Add `migrateStorage` function to assist migrating between different storages

This function can itself be used as a storage config. For example, to migrate
from the PO file to JSON:

```js
// wuchale.config.js
import { defineConfig, pofile, migrateStorage } from "wuchale"
import { json } from "@wuchale/json"

export default defineConfig({
    // ...
    adapters: {
        main: svelte({
            // ...
            storage: migrateStorage([pofile()], json())
        })
    }
})
```

After running `npx wuchale` with this config, it can be replaced by the target
storage config.
