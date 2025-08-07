---
"wuchale": minor
"@wuchale/svelte": minor
---

Use consistent name for proxy modules

You will have to update the imports in your loaders from:
```js
import ... from 'virtual:wuchale/loader'
// or
import ... from 'virtual:wuchale/loader/sync'
```

To:

```js
import ... from 'virtual:wuchale/proxy'
// or
import ... from 'virtual:wuchale/proxy/sync'
```
