# [sv](https://svelte.dev/docs/cli/overview) community add-on: [@wuchale/sv](https://github.com/@wuchale/sv)

> [!IMPORTANT]
> Svelte maintainers have not reviewed community add-ons for malicious code. Use at your discretion

## Usage

To install the add-on, run:

```shell
npx sv add wuchale
```

## What you get

- `wuchale` and `@wuchale/svelte` added as dependencies
- `wuchale()` plugin added to your Vite config
- `wuchale.config.js` generated with your chosen locales
- `.wuchale` added to `.gitignore`
- _(optional)_ `hooks.server` and `+layout` files set up with locale detection and loading (SvelteKit)
- _(optional)_ `App.svelte` updated with locale state and loader import (plain Svelte)

## Options

### `languages`

A comma-separated list of [BCP 47](https://www.ietf.org/rfc/bcp/bcp47.txt) language tags to support.

Default: `en, es`

```shell
npx sv add wuchale="languages:en,zh-TW,fr"
```

### `generation`

Whether to generate and inject example setup files (`hooks.server`, `+layout` for SvelteKit; `App.svelte` for plain Svelte).

Default: `true`

```shell
npx sv add wuchale="generation:false"
```
