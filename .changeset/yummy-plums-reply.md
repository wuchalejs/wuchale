---
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/astro": minor
"@wuchale/jsx": minor
---

⚠️ BREAKING: reorganize loading config, use glob patterns and number load IDs

- `granularLoad` is now `loading.granular`
- `bundleLoad` is now `loading.direct`
- `generateLoadID` is replaced by a glob config at `loading.group`

Therefore if you use any of these, update your config like this:

```diff
-import { defineConfig, defaultGenerateLoadID, pofile } from "wuchale"
+import { defineConfig, pofile } from "wuchale"
import { adapter as svelte } from '@wuchale/svelte'
 
export default defineConfig({
    // ...
    adapters: {
        main: svelte({
            // ...
           bundleLoad: true,
-          granularLoad: true,
-          generateLoadID: filename => {
-              if (filename.includes('grouped')) {
-                  return 'grouped'
-              }
-              return defaultGenerateLoadID(filename)
-          },
+          loading: {
+              granular: true,
+              direct: true,
+              group: [
+                  '**/*grouped*',
+              ]
+          }
       }),
    }
})
```
