---
"@wuchale/vite-plugin": minor
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/jsx": minor
---

BREAKING: Add support for 3rd party component libraries

The `sourceLocale` is now configured on a per-adapter basis, and on the top level, all `locales` have to be specified.

You have to make some changes to your config:

```diff
 {
-    sourceLocale: 'en',
-    otherLocales: ['es', 'fr'],
+    locales: ['en', 'es', 'fr'],
     adapters: {
         main: svelte({
+            sourceLocale: 'en',
             // ...
         })
     }
 }
```

If the `sourceLocale` is `en`, it is already the default so you don't need to specify it.

And now to use 3rd party component libraries, you can specify the file locations in the package dir under `node_modules`:

```js
{
    //...
    adapters: {
        lib: svelte({
            files: 'node_modules/foo-lib/dist/*.svelte',
        })
    }
}
```

And additionally, to make sure that Vite doesn't interfere during dev, you can exclude the library from startup optimization:

```js
export default defineConfig({
    optimizeDeps: {
        exclude: ['foo-lib'],
    },
})
```
