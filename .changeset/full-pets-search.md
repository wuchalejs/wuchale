---
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/jsx": minor
---

Removed the `init` cli command. Loaders are now specified in the config.

The interactive `init` command was mainly created to scaffold loaders. But
since most devs don't touch the loaders and since updates to what the loaders
are expected to export and their locations is not that straightforward to keep
up with the package updates, the command has been removed, and the loaders can
be specified in the adapter configuration using the key `loader`.

The loader config can take some default included loaders and additionally
`custom` as a value. For example, the Svelte adapter can accept the values
`svelte`, `sveltekit` and `custom`.

Specifying the included loaders (`svelte` or `sveltekit` in the example case)
means you don't want to control their content and want to use the default. And
so the loader(s) contents are (over)written at dev server startup or the
`extract` command. That way, they are automatically kept up to date with the
package. But if you want to do custom stuff with the loaders, and don't want
them to be overwritten, you can specify `custom`.

The location of the loaders is next to the catalogs, and follows this naming convention:

```
{adapter key}.loader[.server].{loader extension}
```

For example, for a SvelteKit project, it can be:  `main.loader.svelte.js`
(client) and `main.loader.server.svelte.js` (server). Therefore, if you take
ownership of these files and do custom stuff, you can specify `custom` in the
adapter config.
