<p align="center">
    <a href="https://wuchale.dev/">
        <img width="180" src="https://raw.githubusercontent.com/wuchalejs/wuchalejs.github.io/main/public/favicon.svg" alt="wuchale logo">
    </a>
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/wuchale"><img src="https://img.shields.io/npm/v/wuchale.svg" alt="npm package"></a>
  <a href="https://github.com/wuchalejs/wuchale/actions/workflows/node.js.yml"><img src="https://github.com/K1DV5/wuchale/actions/workflows/node.js.yml/badge.svg?branch=main" alt="build status"></a>
  <a href="https://pr.new/wuchalejs/wuchale"><img src="https://developer.stackblitz.com/img/start_pr_dark_small.svg" alt="Start new PR in StackBlitz Codeflow"></a>
  <a href="https://discord.gg/ypVSZTbzvG"><img src="https://img.shields.io/badge/chat-discord-blue?style=flat&logo=discord" alt="discord chat"></a>
</p>
<br/>

# 📜`wuchale`🪶

**`wuchale`** is a non-invasive, normal code based compile-time internationalization (i18n) toolkit.

- **🔤 No extra syntax!** - your normal code is enough
- **📦 Tiny catalogs to bundle** - Text catalogs are just arrays, no keys necessary, like Protobuf
- **🔧 Zero-effort integration** - Add i18n to existing projects without rewriting code
- **🤖 Optional AI translation** - Gemini integration for automatic on-the-fly translations
- **🔄 Full, granular HMR support** - Live updates during development, including AI auto-translation
- **📦 Tiny footprint** - Only 2 or 3 additional dependencies (`wuchale` + `pofile`), no bloated `node_modules`
- **🎯 Smart extraction** - Uses AST analysis: handles nested markup, conditionals, loops, and complex interpolations
- **🌍 Standard .po files** - Compatible with existing translation tools and workflows

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

Checkout examples to see how it can be used at **[`wuchalejs/examples`](https://github.com/wuchalejs/examples)**.

## Repository structure

This is a monorepo that houses these packages:

- [`wuchale`](https://npmjs.com/package/wuchale): Core + CLI + Vanilla adapter
- [`@wuchale/svelte`](https://npmjs.com/package/@wuchale/svelte): Svelte adapter
- [`@wuchale/vite-plugin`](https://npmjs.com/package/@wuchale/vite-plugin): The Vite plugin

## 📚 Documentation

See the full guide at: [wuchale.dev](https://wuchale.dev/).

## 🤝 Contributing

Contributions are welcome! Please check out our test suites located inside each
package for examples of supported scenarios.

## ❤️ Support & Acknowledgments

> Thank you **[@hayzamjs](https://github.com/hayzamjs)** for making a donation
and using it in [Sylve](https://github.com/AlchemillaHQ/Sylve), and giving
valuable feedback!

If you find `wuchale` valuable and you enjoy working with it, [supporting
it](https://github.com/sponsors/K1DV5) would mean a lot.
