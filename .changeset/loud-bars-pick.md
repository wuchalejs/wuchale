---
"wuchale": minor
"@wuchale/svelte": patch
"@wuchale/astro": patch
"@wuchale/jsx": patch
---

⚠️ BREAKING: Rename config `hmr` to `dev` with the options `'full' | 'read' | false` to control behavior during dev:

- `'full'`: Same behavior as the previous `hmr: true`
- `'read'`: Only uses existing translations and doesn't add newly detected messages during dev
- `false`: Same behavior as the previous `hmr: false`
