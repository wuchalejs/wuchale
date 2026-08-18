---
"wuchale": minor
---

!Use CLDR plural rules from `Intl` instead of PO file headers
  
The `plural` function is now provided in a `plural.js` file in `localesDir`,
and it uses the CLDR rules from the runtime environment (Browsers, Node.js,
etc) instead of expecting the rules to be manually defined inside the catalogs.
Its signature is also different. Instead of expecting a rule function as the
last argument, it expects a `locale`, which is automatically provided at
transform time, with the default being the first one in the `locales` config.
Therefore, if you need plurals, import and use this new one.

```js
import plural from "../locales/plural.js"
// ...
plural(42, ['a day', '# days'])
```

If you use locales that are not covered by CLDR, you can define another
`plural` function with the same signature, optionally using this one as a
fallback for the locales that are, with your custom selection logic, and use
that. The import location is not checked at transform time, only the name and
signature.

All plurals are now fully validated when they are translated using AI or when
using the CLI's `check` command.
