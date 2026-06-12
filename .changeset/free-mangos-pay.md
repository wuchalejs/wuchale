---
"wuchale": minor
"@wuchale/astro": patch
"@wuchale/jsx": patch
"@wuchale/svelte": patch
---

⚠️ BREAKING: proxies now export `loadCount` instead of `loadIDs` after #355

The default loaders have been updated to match but if you use `loadLocales` in SvelteKit hooks or Astro middlewares, you should update them like:

```diff
-await loadLocales(main.key, main.loadIDs, main.loadCatalog, locales)
+await loadLocales(main.key, main.loadCount, main.loadCatalog, locales)
```
