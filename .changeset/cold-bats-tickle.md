---
"wuchale": minor
---

Add support for locale fallback chains

This is only for when the message is not yet translated. With no configuration,
for locales that have regional variants like `fr-CH`, it falls back to the base one `fr`.
And explicit chains can be configured by providing from-to pairs in the `fallback` key:

```js
// wuchale.config.js
export default {
    // ...
    fallback: {
        'fr-CH': 'fr-FR',
        'fr-FR': 'fr-ES',
    },
    // ...
}
```

And then the chain for would be `fr-CH` -> `fr-FR` -> `fr-ES` -> `fr` -> `en`.
