---
"wuchale": minor
---

Add support for delaying setting the current locale after loading the catalogs (#163)

You can now use `commitLocale` after `loadLocale(locale, false)` to separate
loading from rendering.
This can solve SvelteKit rendering the other locale on hover over the language
link when preloading is on, by using it in `$effect.pre`.
Previously `loadLocale` accepted `key` as the second argument to selectively
load catalogs by adapter key. It will now load all available catalogs.
