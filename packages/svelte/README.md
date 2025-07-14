# `wuchale` svelte

[![npm version](https://img.shields.io/npm/v/wuchale)](https://www.npmjs.com/package/wuchale) ![License](https://img.shields.io/github/license/K1DV5/wuchale)

A non-invasive compile-time internationalization (i18n) toolkit.
Inspired by Lingui, built from scratch with performance, clarity, and
simplicity in mind.

> 🎯 **Smart translations, tiny runtime, full HMR.** Extract strings at build
> time, generate optimized translation catalogs, support live translations
> (even with Gemini AI), and ship minimal code to production.

## Why `wuchale`?

Traditional i18n solutions require you to wrap every translatable string with
function calls or components. `wuchale` doesn't.

```svelte
<!-- Traditional i18n -->
<p>{t('Hello')}</p>
<p><Trans>Welcome {userName}</Trans></p>

<!-- With wuchale -->
<p>Hello</p>
<p>Welcome {userName}</p>
```

Write your Svelte code naturally. No imports, no wrappers, no annotations.
`wuchale` handles everything at compile time.

Try live examples in your browser, no setup required:

- Svelte: [![Svelte example on StackBlitz](https://img.shields.io/badge/StackBlitz-Demo-blue?logo=stackblitz)](https://stackblitz.com/github/K1DV5/wuchale/tree/main/examples/svelte)
- SvelteKit: [![SvelteKit example on StackBlitz](https://img.shields.io/badge/StackBlitz-Demo-blue?logo=stackblitz)](https://stackblitz.com/github/K1DV5/wuchale/tree/main/examples/sveltekit)

## ✨ Key Features

- **🔧 Zero-effort integration** - Add i18n to existing projects without rewriting code
- **🚀 Compile-time optimization** - All transformations happen during build, minimal runtime overhead
- **🔄 Full, granular HMR support** - Live updates during development, including auto-translation
- **📦 Tiny footprint** - Only 2 additional dependencies (`wuchale` + `pofile`), no bloated `node_modules`
- **🎯 Smart extraction** - Uses AST analysis: handles nested markup, conditionals, loops, and complex interpolations
- **🌍 Standard .po files** - Compatible with existing translation tools and workflows
- **🤖 Optional AI translation** - Gemini integration for automatic translations during development
- **⚡ Svelte 5 ready** - Built for the future with runes and snippets support

## 🚀 Quick Start

### 1. Install

```bash
npm install wuchale @wuchale/svelte
```

### 2. Configure Vite

```javascript
// vite.config.js
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { wuchale } from 'wuchale'

export default {
    plugins: [
        wuchale(),
        svelte(),
    ]
}
```

### 3. Create Configuration

Create `wuchale.config.js` in your project root:

```javascript
// @ts-check
import { adapter as svelte } from "@wuchale/svelte"
import { defineConfig } from "wuchale"

export default defineConfig({
    locales: {
        // English included by default
        es: { name: 'Spanish' },
        fr: { name: 'French' }
    },
    adapters: {
        main: svelte(),
    }
})
```

### 4. Create the locales directory

```bash
mkdir src/locales
```

### 5. Add CLI Scripts

```jsonc
// package.json
{
  "scripts": {
    "extract": "wuchale",
    "clean": "wuchale --clean"
  }
}
```

### 6. Setup in Your App

#### For SvelteKit (SSR/SSG)

```typescript
// src/routes/+layout.js
import { setCatalog } from 'wuchale/runtime.svelte.js'

export async function load({ url }) {
    const locale = url.searchParams.get('locale') ?? 'en'
    // or you can use [locale] in your dir names to get something like /en/path as params here
    setCatalog(await import(`../locales/${locale}.svelte.js`))
    return { locale }
}
```

```typescript
// src/hooks.server.js
import { runWithCatalog } from 'wuchale/runtime-server'

export async function handle({ event, resolve }) {
    const locale = event.url.searchParams.get('locale') ?? 'en'
    const catalog = await import(`./locales/${locale}.svelte.js`)
    const response = await runWithCatalog(catalog, async () => await resolve(event))
	return response;
}
```

#### For Svelte (SPA)

```svelte
<!-- src/App.svelte -->
<script>
    import { setCatalog } from 'wuchale/runtime.svelte.js'
    
    let locale = $state('en')
    
    async function loadTranslations(locale) {
        setCatalog(await import(`./locales/${locale}.svelte.js`))
    }
</script>

{#await loadTranslations(locale)}
    <!-- @wc-ignore -->
    Loading translations...
{:then}
    <!-- Your app content -->
{/await}
```

### 7. Start Coding!

Write your Svelte components naturally. `wuchale` will extract and compile translations automatically:

```svelte
<h1>Welcome to our store!</h1>
<p>Hello {userName}, you have {itemCount} items in your cart.</p>
```

For full usage examples, look inside the **[examples directory](https://github.com/K1DV5/wuchale/tree/main/examples)**.

## 📖 How It Works

[See main README](https://github.com/K1DV5/wuchale)


### AI Translation

Enable Gemini translations by setting `GEMINI_API_KEY`:

```bash
GEMINI_API_KEY=your-key npm run dev
```

## 📁 File Structure

```
src/
├── locales/
│   ├── en.po         # Source catalog (commit this)
│   ├── en.svelte.js  # Compiled data module (gitignore)
│   ├── es.po         # Translation catalog (commit this)
│   └── es.svelte.js  # Compiled data module (gitignore)
└── App.svelte        # Your components
```

## 🧠 Behavior Explanation (Svelte adapter)

### What Gets Extracted?

This is decided by the heuristic function which you can customize. A sensible
default heuristic function is provided out of the box. Here's how it works:

#### General rule (applies everywhere):
- If the text contains no letters used in any natural language (e.g., just numbers or symbols), it is ignored.

#### In `markup` (`<p>Text</p>`):
- All textual content is extracted.

Examples:

```svelte
<p>This is extracted</p>
<!-- @wc-ignore -->
<p>This is not extracted</p>
```

#### In `attribute` (`<div title="Info">`):
- If the first character is a lowercase English letter (`[a-z]`), it is ignored.
- If the element is a `<path>`, it is ignored (e.g., for SVG `d="M10 10..."` attributes).
- Otherwise, it is extracted.

Examples:

```svelte
<img alt="Profile Picture" class="not-extracted" />
```

#### In `script` (`<script>` and `.svelte.js/ts`):

`script` is handled by the ES adapter of the core package with some additional restrictions.
- If it doesn't pass the base heuristic from the ES adapter, it is ignored.
- If it's not inside `$derived` or `$derived.by`, it is ignored.
- If the value is inside `$inspect()` calls, it is ignored.
- Otherwise, it is extracted.

Examples:

```javascript
// In $derived or functions
const message = $derived('This is extracted')
const lowercase = $derived('not extracted')

// Force extraction with comment
const forced = $derived(/* @wc-include */ 'force extracted')
```
```svelte
<p title={'Extracted'}>{/* @wc-ignore */ 'Ignore this'}</p>
```

If you need more control, you can supply your own heuristic function in the
configuration. Custom heuristics can return `undefined` or `null` to fall back
to the default. For convenience, the default heuristic is exported by the
package.

> 💡 You can override extraction with comment directives:
> - `@wc-ignore` — skips extraction
> - `@wc-include` — forces extraction  
> These always take precedence.

### Nested Content

Complex nested structures are preserved:

```svelte
<p>Welcome to <strong>{appName}</strong>, {userName}!</p>
```

Extracted as:
```
Welcome to <0/>, {0}!
```

### Pluralization

Define your function
```javascript
// in e.g. src/utils.js
export function plural(num, candidates, rule = n => n === 1 ? 0 : 1) {
    const index = rule(num)
    return candidates[index].replace('#', num)
}
```

Use it

```svelte
<script>
    import {plural} from '/src/utils.js'
    let itemCount = 5
</script>

<p>{plural(itemCount, ['One item', '# items'])}</p>
```

### Context

Disambiguate identical texts:

```svelte
<!-- @wc-context: navigation -->
<button>Home</button>

<!-- @wc-context: building -->
<span>Home</span>

```

### Useful Usage Pattern

A common scenario is needing to prevent string extraction inside functions, but
you may not want to modify the global heuristic or litter your code with
comment directives. A cleaner approach is to extract constants to the top
level, which are ignored by default:

```js
const keys = {
  Escape: 'Escape',
  ArrowUp: 'ArrowUp',
  // ...
};

function eventHandler(event) {
  if (event.key === keys.Escape) {
    // ...
  }
}
```

## 🛠️ Configuration Reference (Svelte Adapter)

For the main plugin configuration, lood at the main README.

```javascript

import { adapter as svelte } from "@wuchale/svelte"

const svelteAdapter = {
    // Where to store translation files. {locale} will be replaced with the respective locale.
    catalog: './src/locales/{locale}',
    
    // Files to scan for translations
    // You can technically specify non svelte js/ts files, but they would not be reactive
    files: ['src/**/*.svelte', 'src/**/*.svelte.{js,ts}'],
    
    // Custom extraction logic
    // signature should be: (text: string, details: object) => boolean | undefined
    // details has the following properties:
        // scope: "markup" | "attribute" | "script",
        // topLevel?: "variable" | "function" | "expression",
        // topLevelCall?: string,
        // call?: string,
        // element?: string,
        // attribute?: string,
        // file?: string,
    heuristic: defaultHeuristic,
    
    // Your plural function name
    pluralFunc: 'plural',
}
```
