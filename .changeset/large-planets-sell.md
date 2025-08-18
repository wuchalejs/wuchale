---
"@wuchale/vite-plugin": minor
"wuchale": minor
---

Enable sharing catalogs between adapters

Now you can use the same catalogs with different catalogs and they will work
with each other on the same file. But they still need different loader files.
Therefore, A new adapter config option `loaderPath` was added so that different
loaders can be specified.
