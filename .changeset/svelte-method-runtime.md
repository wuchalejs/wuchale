---
"@wuchale/svelte": patch
---

Fix class methods getting a `$derived` runtime (triggering `state_referenced_locally` warnings), and functions in `.svelte.ts` files using a runtime that was never declared
