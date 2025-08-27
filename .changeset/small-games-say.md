---
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/jsx": minor
---

Separate reactive and plain loader functions

This is to fix errors happening specifically with React as it doesn't allow
using hooks inside non hooks or components. But it opens up finer
configurations for Svelte and SolidJS as well for which the defaults have been
adjusted as well.

You can now export different functions from the loader files for reactive (e.g.
using hooks) and non reactive (e.g. just simple object lookup) and tell
`wuchale` their names using configuration options, and also adjust which one is
used when.

If you want to update your loader(s), you can do `npx wuchale init` and select
another one than `existing`.
