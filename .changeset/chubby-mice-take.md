---
"wuchale": minor
---

Make runtime error message configurable

You can configure the message shown when the message index is not found
in the compiled catalog. By default it is something like `[i18n-404:0]`.
You can use the static method at the app startup and it applies globally.

```js
import {Runtime} from 'wuchale/runtime'

Runtime.setErrMsg(i => `not-found:${i}`)
// or if you use async loading and want to show nothing until the catalogs are loaded
Runtime.setErrMsg(() => '')
```
