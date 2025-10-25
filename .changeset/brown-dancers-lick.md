---
"@wuchale/vite-plugin": minor
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/jsx": minor
---

Always use physical files, change `catalog` config to `localesDir`

Previusly virtual modules offered by Vite made it possible to keep the file system
clean and a slight performance advantage when building, but they had disadvantages:

- Inspecting what Wuchale generates was not possible unless the `writeFiles` config was enabled
- They don't work outside of Vite
- Supporting physical files was therefore unavoidable and that meant supporting two different systems to export the same things

Now everything is written to disk, including proxies, compiled catalogs, and
locales data too. And `writeFiles` has been removed. In cases where writing the
transformed code is desired, the destination can be provided to the `outDir` adapter
config.

The second thing is that the location of the catalog files was previusly
specified using the `catalog` adapter config, which accepted a substitution
parameter, `{locale}` but it's an unnecessary complexity that can lead to
problems, and it's not just catalogs that's stored in that location. Therefore,
it has been replaced by the self descriptive config, `localesDir`.
