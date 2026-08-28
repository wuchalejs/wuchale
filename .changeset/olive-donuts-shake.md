---
"@wuchale/svelte": patch
---

Fix `{@const}` being wrapped in `$derived`, producing invalid Svelte

Translated `{@const}` declarations were emitted as `{@const x = $derived(...)}`, which
Svelte rejects with
[`state_invalid_placement`](https://svelte.dev/e/state_invalid_placement). `{@const}` is
already re-evaluated along with its enclosing block, so it never needs the wrapper.

`{let}` and `{const}` declaration tags are still wrapped as before.
