---
"wuchale": minor
"@wuchale/jsx": patch
"@wuchale/svelte": patch
---

Improve loading utilities structure

This is to allow more flexibility when using the provided loading utilities.

1. They have moved to `wuchale/loading-utilities/{client,server,pure}.js` to
   collect them under one dir.
2. The new `pure` module contains the side effect free loading function
   previously under the run-client module.
3. The client utility `registerLoaders` function's optional fourth argument is
   now an object with `get` and `set` methods. This allows more control over
    the state of the catalogs.
