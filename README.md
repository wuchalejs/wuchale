# `wuchale`

[![npm version](https://img.shields.io/npm/v/wuchale)](https://www.npmjs.com/package/wuchale) [![npm version](https://img.shields.io/npm/v/@wuchale/svelte)](https://www.npmjs.com/package/@wuchale/svelte) ![License](https://img.shields.io/github/license/K1DV5/wuchale)

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

Write your code naturally. No imports, no wrappers, no annotations.
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

## 🚀 Quick Start

Currently the following are supported. Visit the links for specific information.

- [Plain JS/TS](https://github.com/K1DV5/wuchale/tree/main/packages/core)
- [Svelte/SvelteKit](https://github.com/K1DV5/wuchale/tree/main/packages/svelte)

For full usage examples, look inside the **[examples directory](https://github.com/K1DV5/wuchale/tree/main/examples)**.

## 📖 How It Works

![Diagram](https://raw.githubusercontent.com/K1DV5/wuchale/main/images/diagram.svg)

### Compilation Process

1. **Extract** - AST traversal identifies translatable text
2. **Transform** - Text nodes replaced with `wuchaleTrans.t(n)` calls
3. **Catalog** - Updates .po files with new/changed messages
4. **Translate** - Optional Gemini AI translation for new messages
5. **Compile** - Generates optimized JavaScript modules
6. **Bundle** - Vite handles HMR in dev, optimized builds for production

### What Gets Extracted?

There are three possible `scope`s for text to be extracted.

- Markup: all text inside elements, always meant to be translated
- Attribute: text inside attribute values of elements
- Script: normal and template strings

How these are handled depends on the specific adapter.

### AI Translation

Enable Gemini translations by setting `GEMINI_API_KEY`:

```bash
GEMINI_API_KEY=your-key npm run dev
```

## 📁 File Structure

`wuchale` creates two files per locale per adapter. Taking Svelte as an example,

```
src/
├── locales/
│   ├── en.po         # Source catalog (commit this)
│   ├── en.svelte.js  # Compiled data module (gitignore)
│   ├── es.po         # Translation catalog (commit this)
│   └── es.svelte.js  # Compiled data module (gitignore)
└── App.svelte        # Your components
```

The `.js` file suffix depends on the specific adapter.

## 🤝 Contributing

Contributions are welcome! Please check out our test suites located inside each package for examples of supported scenarios.

## ❤️ Sponsors

Thank you **[@hayzamjs](https://github.com/hayzamjs)** for sponsoring the
project and using it in [Sylve](https://github.com/AlchemillaHQ/Sylve), giving
valuable feedback!
