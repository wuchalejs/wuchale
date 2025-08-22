---
"wuchale": patch
---

Prevent errors on SSR loading in some cases

Like with SvelteKit on StackBlitz, it seems it loses the `AsyncLocalStorage`
context inside the request. But this should't affect normal usage.
