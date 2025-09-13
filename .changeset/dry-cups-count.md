---
"wuchale": minor
---

Expose interface to make AI translator customizable

You can now use a custom translator model other than Gemini
by supplying the info in the config:

```js
export default {
    //...
    ai: {
        name: 'ChatGPT', // e.g.
        batchSize: 50,
        translate: (items, instruction) => {
            // logic
            return translatedItems
        }
    }
    //...
}
```
