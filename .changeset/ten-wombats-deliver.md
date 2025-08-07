---
"@wuchale/vite-plugin": minor
"wuchale": minor
---

Move the storage of plural rules to PO files and simplify config

This makes sure that the po files are the single source
of truth for translations as well as plural rules. The
translator can update the rules as well. And for the language
names, Intl.DisplayNames can be used and is more versatile.
Then the only thing that needs to be specified in the config
is the codes of the locales, nothing else. This makes the config
simpler. To update your config, you have to have an array of the
other locales' codes instead of an object for all locales. English
will continue to be the `sourceLocale`.

```js
export default {
  otherLocales: ['es', 'fr'],
  adapters: ...
}
```
