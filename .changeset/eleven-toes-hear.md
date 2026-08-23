---
"wuchale": minor
---

Add support for interpolations (template strings) in plural messages #406
  
Template strings in plurals are now extracted properly, even when they have
non-uniform interpolations like:

```js
plural(items, ['An item', `${items} items in ${container}`])
```

It still works, because it collects all unique values in a single place and
shares them among all, and therefore the values can even be used in different
places in the translations as necessary.
