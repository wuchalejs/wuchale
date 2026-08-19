---
"wuchale": minor
---

!Stop forcing `pre` on Vite `transform` hook to play nice with other plugins
  
This makes it possible to use other plugins that extend the language syntax
like
[svelte-effect-runtime](https://github.com/artisanstreet/svelte-effect-runtime)
allowing their plugins to be placed before `wuchale()` so that wuchale can get
a normal syntax and prevent syntax errors. If you don't have `wuchale()` in the
beginning of the Vite `plugins` config, move it earlier.
