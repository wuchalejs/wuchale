---
"wuchale": minor
---

Expose interface to make AI translator customizable

You can now use a custom translator model other than Gemini by supplying the info in the config:

```js
export default {
    //...
    ai: {
        name: 'ChatGPT', // e.g.
        batchSize: 50,
        parallel: 10,
        translate: (content, instruction) => {
            // logic
            return translatedContent
        }
    }
    //...
}
```

Gemini is still the default, but now it's separated out and was made customizable:

```js
import { gemini } from "wuchale"

export default {
    //...
    ai: gemini({
        batchSize: 40,
        parallel: 5,
        think: true, // default: false
    })
    //...
}
```
