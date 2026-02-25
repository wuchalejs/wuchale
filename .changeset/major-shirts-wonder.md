---
"wuchale": minor
---

Add support for pluggable storage handlers

While the PO for format is a solid choice for most cases, there may be some cases where another format is desired. Therefore, support for storing messages in PO files will continue to be provided out of the box but there will be an interface where another format can be plugged instead. The basic usage will be as a config option to the adapter like:

```js
export default {
  // ...
  adapters: {
    main: svelte({
      // ...
      storage: pofile({ dir: '...' })
    })
  }
}
```

And the storage key can accept any implementation that supports the expected shape for a storage collection.
