---
"wuchale": patch
---

Fix expressions inside TS `as` and `<assert>` expressions not checked when setting heuristic `topLevelCall` which led to Svelte `$derived(...) as Type` being wrapped in another `$derived`
