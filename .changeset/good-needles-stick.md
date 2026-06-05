---
"wuchale": minor
"@wuchale/json": minor
---

⚠️ BREAKING: Composable storage: `dir` config in `pofile` and `json` storage changed to `location`, `separateUrls` removed.

The `dir` config which was used to set the directory under which to save
catalog storages is now replaced by `location` which gives more control. In
`pofile` it should be a file path pattern with `{locale}` as a placeholder. If
you use `separateUrls` (which was `true` by default), you should now use the
new `storageByType` layer:

```diff
-import { pofile } from 'wuchale'
+import { pofile, storageByType } from 'wuchale'

export default {
    // ...
    adapters: {
        main: svelte({
            // ...
-            storage: pofile({dir: 'src/locales'}),
+            storage: storageByType({
+                message: pofile({location: 'src/locales/{locale}.po'}),
+                url: pofile({location: 'src/locales/{locale}.url.po'})
+            }),
        }),
    }
}
```

`storageByType` returns a storage itself, but if you don't need to separate the
items, you can opt not to use it. But it also opens the possibility of storing
URL translations in another format for example.
