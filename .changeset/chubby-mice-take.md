---
"wuchale": minor
---

Make runtime error message configurable

You can now configure the message shown when the message index is not found in
the compiled catalog array. By default, it is something like `[i18n-404:0]`
during dev mode and empty `''` in production. You can use the static method at
startup (anywhere in your app) to override it. It applies globally.

```js
import { Runtime } from 'wuchale/runtime'

Runtime.onInvalid((i, arr) => arr[i] == null ? `not-found:${i}` : `bad:${arr[i]}`)
```
