---
"wuchale": minor
"@wuchale/svelte": patch
"@wuchale/astro": patch
"@wuchale/jsx": patch
---

⚠️ BREAKING: Rename config `hmr` to `dev` with the following options to control behavior during dev:

- `false`: Same behavior as the previous `hmr: false`
- `'read'`: Only uses existing translations and doesn't add newly detected messages during dev
- `'add'`: Adds newly detected messages and updates their refs as they get referenced, but doesn't touch existing messages
- `'refs'`: Same behavior as the previous `hmr: true`, adds new messages, updates refs and marks obsoletes
- `'clean'`: Full behavior same as `npx wuchale --clean`, deletes unused messages
