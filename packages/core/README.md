# `wuchale` core

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

```typescript
// Traditional i18n
const t = i18n('Hello')

// With wuchale
const t = 'Hello'
```

Write your code naturally. No imports, no wrappers, no annotations.
`wuchale` handles everything at compile time.

## ✨ Key Features

- **🔧 Zero-effort integration** - Add i18n to existing projects without rewriting code
- **🚀 Compile-time optimization** - All transformations happen during build, minimal runtime overhead
- **🔄 Full, granular HMR support** - Live updates during development, including auto-translation
- **📦 Tiny footprint** - Only 2 additional dependencies (`wuchale` + `pofile`), no bloated `node_modules`
- **🎯 Smart extraction** - Uses AST analysis: handles nested markup, conditionals, loops, and complex interpolations
- **🌍 Standard .po files** - Compatible with existing translation tools and workflows
- **🤖 Optional AI translation** - Gemini integration for automatic translations during development

## 📦 Available adapters

To use `wuchale` you need the main `vite` plugin (this package) and an adapter
for your project type. The following adapters are currently available:

- JavaScript/TypeScript (ES adapter): included in this package.
- Svelte: [here](https://www.npmjs.com/package/@wuchale/svelte)

## 🚀 Quick Start

We will use the ES adapter as an example.

### 1. Install

```bash
npm install wuchale
```

### 2. Configure Vite

```javascript
// vite.config.js
import { wuchale } from 'wuchale'

export default {
    plugins: [
        wuchale(),
    ]
}
```

### 3. Create Configuration

Create `wuchale.config.js` in your project root:

```javascript
// @ts-check
import { adapter as esAdapter } from "wuchale/adapter-es"
import { defineConfig } from "wuchale"

export default defineConfig({
    locales: {
        // English included by default
        es: { name: 'Spanish' },
        fr: { name: 'French' }
    },
    adapters: {
        main: esAdapter(),
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

```javascript
// src/index.js
import { setCatalog } from 'wuchale/runtime'

export async function setup(locale) {
    setCatalog(await import(`../locales/${locale}.js`))
}
```

### 7. Start Coding!

Write your code naturally. `wuchale` will extract and compile translations automatically:

```javascript
function eventHandler(event) {
    event.target.value = 'Hello!'
}
```

## 📖 How It Works

[See main README](https://github.com/K1DV5/wuchale)

## AI Translation

Enable Gemini translations by setting `GEMINI_API_KEY`:

```bash
GEMINI_API_KEY=your-key npm run dev
```

## 📁 File Structure

```
src/
├── locales/
│   ├── en.po  # Source catalog (commit this)
│   ├── en.js  # Compiled data module (gitignore)
│   ├── es.po  # Translation catalog (commit this)
│   └── es.js  # Compiled data module (gitignore)
└── index.js   # Your code
```

## 🧠 Behavior Explanation (ES adapter)

### What Gets Extracted?

This is decided by the heuristic function which you can customize. A sensible
default heuristic function is provided out of the box. Here's how it works:

- If the text contains no letters used in any natural language (e.g., just numbers or symbols), it is ignored.
- If it's in a top-level expression (not inside an assignment or a function definition) it is ignored.
- If the value is inside `console.*()` call, it is ignored.
- If the first character is a lowercase English letter (`[a-z]`) or is any non-letter, it is ignored.
- Otherwise, it is extracted.

Examples:

```javascript

const message = 'This is extracted'
const lowercase = 'not extracted'

// Force extraction with comment
const forced = /* @wc-include */ 'force extracted'

function foo() {
    const extracted = 'Hello!'
}
```

If you need more control, you can supply your own heuristic function in the
configuration. Custom heuristics can return `undefined` or `null` to fall back
to the default. For convenience, the default heuristic is exported by the
package.

> 💡 You can override extraction with comment directives:
> - `@wc-ignore` — skips extraction
> - `@wc-include` — forces extraction  
> These always take precedence.

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

```javascript
import {plural} from '/src/utils.js'

function eventHandler(e) {
    let itemCount = 5
    e.target.value = plural(itemCount, ['One item', '# items'])
}
```

### Context

Disambiguate identical texts:

```typescript
// @wc-context: navigation
const msg = 'Home'

// @wc-context: building
const bldg = 'Home'
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

## 🛠️ Configuration Reference

### Main plugin

```javascript
export default {
    // Source language code
    sourceLocale: 'en',
    
    // Available locales with plural rules
    locales: {
        en: {
            name: 'English',
            // the number of plurals in the language
            nPlurals: 2,
            // The expression to use to decide which candidate to choose when using your plural() function
            // The number should be used as 'n' because this will be the body of an arrow function with n as an argument.
            pluralRule: 'n == 1 ? 0 : 1'
        }
    },
    
    // Adapters are the project type specific bindings for wuchale. For the ES adapter configuration, look below.
    // You can repeat the same adapter with different keys and catalog configurations
    // to break the translations into smaller parts
    adapters: {
        // key: AdapterConf
    }
    
    // Enable HMR updates during development. You can disable this to avoid the small overhead
    // of live translation updates and work solely with the source language.
    // HMR is highly optimized -- it updates only the affected components,
    // preserving application state and avoiding full reloads.
    hmr: true,
    
    // Gemini API key (or 'env' to use GEMINI_API_KEY)
    // if it's 'env', and GEMINI_API_KEY is not set, it is disabled
    // set it to null to disable it entirely
    geminiAPIKey: 'env'
}
```

### ES Adapter

```javascript

import { adapter as esAdapter } from "wuchale/adapter-es"

const esAdapterConf = esAdapter({
    // Where to store translation files. {locale} will be replaced with the respective locale.
    catalog: './src/locales/{locale}',
    
    // Files to scan for translations and transform
    files: ['src/**/*.{js,ts}'],
    
    // Custom extraction logic
    // signature should be: (text: string, details: object) => boolean | undefined
    // details has the following properties:
        // scope: "markup" | "attribute" | "script",
        // topLevel?: "variable" | "function" | "expression",
        // topLevelCall?: string,
        // call?: string,
        // element?: string,
        // attribute?: string,
        // filename?: string,
    heuristic: defaultHeuristic,
    
    // Your plural function name
    pluralFunc: 'plural',
})
```
