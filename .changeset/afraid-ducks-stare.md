---
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/jsx": minor
---

Add the `@wc-ignore-file` comment directive

As an alternative to ignoring a file in the `files` config value, you can now
ignore a whole file by putting this directive at the beginning of the file,
before any extractable messages. The advantage is that it doesn't need a
restart of the dev server and if you rename/move the file it will always be
ignored.
