---
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/astro": minor
"@wuchale/jsx": minor
---

Add support for importing a URL localize function from any module at runtime

This adds support for cases where complete flexibility is needed for URLs, for example
when the site targets different domain names for different locales, and when one locale
can be used in different domains. Now a custom localize function that does the localization
can be implemented, and wuchale only handles the translation. This can be used by providing
the module path:

```js
export default {
    // ...
    adapters: {
        svelte({
            url: {
                localize: 'src/lib/url-util.js',
                patterns: [
                    // ...
                ]
            }
        })
    }
}
```

The module has to export a `localize` function that is of type:

```ts
type URLLocalizer = (url: string, locale: string) => string
```

To just use the default of prefixing the locale to the path, set `localize: true`.
