---
"wuchale": minor
---

⚠️ BREAKING: Built-in URL matcher

A small purpose-built no-RegExp URL matcher is now included and the glob-like syntax it accepts is different from/simpler than that of `path-to-regexp`.

- `*` for required segments like `/foo-*` matches `/foo-bar`
- `?` for optional segments like `/foo/?` matches `/foo` and `/foo/bar`
- `**` for nested like `/foo/**` matches `/foo`, `/foo/bar` and `/foo/1/bar`

If you use URL patterns, you have to adjust your config accordingly:

```diff
export default {
    // ...
    adapters: {
        main: svelte({
            // ...
            url: {
                // ...
                patterns: [
-                   'foo/*rest',
+                   'foo/**',
                ]
            },
        }),
    }
}
```
