---
"@wuchale/vite-plugin": minor
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/jsx": minor
---

Iron out universal HMR, update loaders, organize exports, improve loading reactivity

This change fixes every small issue with HMR, like editing a file and changing the locale,
editing the PO file and then the loader file, etc... it should always work as expected now.

Another thing is that most exports are now from the base `wuchale` package
except those that may be included in the build outputs of applications which
should be selectively loaded to improve tree shaking. Most importantly, the loading utilities are now in:

- `wuchale/load-utils` for client loading
- `wuchale/load-utils/server` for server loading
- `wuchale/load-utils/pure` for side effect-free loading

All of these are optional and if you don't use them, they will not be included in your build.

The client utility `registerLoaders` function's optional fourth argument is now
an object with `get` and `set` methods. This allows more control over the state
of the catalogs for use with the reactivity patterns of any library.
