---
"@wuchale/vite-plugin": minor
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/jsx": minor
---

BREAKING: Update locales config to support for 3rd party component libraries

The `sourceLocale` is now configured on a per-adapter basis, and on the top
level, all desired `locales` have to be specified.

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

Additionally, the `sourceLocale` on the adapter defaults to the first locale in
the main `locales` array.

This allows the use of multiple languages in the source code, which may be
necessary when you are trying to write the source in another language and you
want to use a 3rd party lib written in English for example.

And now to use 3rd party component libraries, you can specify the file
locations in the package dir under `node_modules`:

```js
// wuchale.config.js
{
    //...
    adapters: {
        lib: svelte({
            files: 'node_modules/foo-lib/dist/*.svelte',
        })
    }
}
```

And additionally, to make sure that Vite doesn't interfere during dev, you can
exclude the library from startup optimization:

```js
// vite.config.js
export default defineConfig({
    optimizeDeps: {
        exclude: ['foo-lib'],
    },
})
```
