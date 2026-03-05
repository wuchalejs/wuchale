---
"wuchale": minor
---

`localesDir` is now always shared, and data.js doesn't export `sourceLocale`

You can put the catalogs in different locations by configuring the `dir` for the `pofile` storage as mentioned. But everything wuchale works on is inside a single dir, configurable from the top level config `localesDir`:

```js
export default {
    // ...
    localesDir: 'src/locales'
}
```

All files inside that dir are per adapter, except `data.js` which exported shared data, `locales` and `sourceLocale`. Now `sourceLocale` is not exported because it may be different among adapters. You may have to adjust something if you use it.
