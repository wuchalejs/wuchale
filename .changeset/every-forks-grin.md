---
"@wuchale/vite-plugin": minor
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/jsx": minor
---

Move runtime and reactivity logic for HMR into the transformed code

The `Runtime` instance is now initialized inside the transformed code and now
loaders are required to always return a catalog module. This makes all loaders
consistent and makes the `Runtime` an implementation detail. If your loaders
return `new Runtime(catalog)`, you have to unwrap it and return just `catalog`
(or `undefined` in the case of `new Runtime()`). The default loaders are
updated to return the catalog module. If you haven't modified them and want to
use the new ones, you can overwrite them by running `npx wuchale init` and
selecting a different loader than `existing`.

This also solves the problem where HMR may sometimes not work depending on the
method of loading the catalog modules, by putting all reactivity logic in the
transformed code itself and making it expect just the catalog. This is only for
dev mode so the production builds still stay lean.
