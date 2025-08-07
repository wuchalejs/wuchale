---
"wuchale": minor
"@wuchale/svelte": minor
---

Export adapter key for use in loaders

You can now import the adapter key you set in the config from the proxies
so that you don't have to manually update them if you change them in the config

```js
import { key } from 'virtual:wuchale/proxy'
```
