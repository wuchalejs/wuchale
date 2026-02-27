---
"wuchale": minor
---

Add support for grouping locales for AI translation

You can now group target locales in the same prompt:

```js
export default {
    // ...
    ai: {
        // ...
        group: {
            // en is the source
            en: [
                ['fr', 'fr-FR', 'fr-CH'],
                ['de', 'fr-DE']
            ]
        }
    }
}
```
