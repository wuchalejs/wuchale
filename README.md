<p align="center">
    <a href="https://wuchale.dev/">
        <img width="180" src="https://raw.githubusercontent.com/wuchalejs/wuchalejs.github.io/main/public/favicon.svg" alt="wuchale logo">
    </a>
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/wuchale"><img src="https://img.shields.io/npm/v/wuchale?logo=npm&logoColor=red&color=blue" alt="npm package"></a>
  <a href="https://github.com/wuchalejs/wuchale/actions/workflows/node.js.yml"><img src="https://github.com/K1DV5/wuchale/actions/workflows/node.js.yml/badge.svg?branch=main" alt="build status"></a>
  <a href="https://pr.new/wuchalejs/wuchale"><img src="https://developer.stackblitz.com/img/start_pr_dark_small.svg" alt="Start new PR in StackBlitz Codeflow"></a>
  <a href="https://discord.gg/ypVSZTbzvG"><img src="https://img.shields.io/badge/chat-discord-blue?style=flat&logo=discord" alt="discord chat"></a>
</p>
<br/>

# 📜`wuchale`🪶

**`wuchale`** is a compile-time internationalization (i18n) toolkit that
requires zero code changes. Write your components naturally, and `wuchale`
automatically extracts and replaces translatable strings at build time.

- **✨ No extra syntax!** - Your normal code is enough
- **📦 Tiny catalogs to bundle** - Text catalogs are just arrays, no keys necessary, like Protobuf
- **🔌 Zero-effort integration** - Add i18n to existing projects without rewriting code
- **🤖 Optional AI translation** - Gemini integration for automatic on-the-fly translations
- **⚡ Full, granular HMR support** - Live updates during development, including AI auto-translation
- **📦 Tiny footprint** - Very few (less than 5) additional dependencies, no bloated `node_modules`
- **🧠 Smart extraction** - Uses AST analysis to handle nested markup, conditionals, loops, and complex interpolations
- **🌍 Standard .po files** - Compatible with existing translation tools and workflows

## Why `wuchale`?

Traditional i18n solutions require you to wrap every translatable string with
function calls or components. `wuchale` doesn't.

Traditional i18n:
```svelte
<p>{t('Hello')}</p>
<p><Trans>Welcome {userName}</Trans></p>
```

With `wuchale`:
```svelte
<p>Hello</p>
<p>Welcome {userName}</p>
```

Write your code naturally. No imports, no wrappers, no annotations. `wuchale`
handles everything at compile time by analyzing your code and automatically
extracting translatable strings.

## Getting started

`wuchale` can be used in several ways depending on your project setup:

- **Standalone CLI** - For any JavaScript/TypeScript project
- **Vite Plugin** - For Vite-based projects with vanilla JS/TS
- **Framework Adapters** - Specialized support for React/Preact, Svelte, and SolidJS

**Installation and setup varies by use case.** See the [Getting Started
guide](https://wuchale.dev/intro/start/) for detailed instructions specific to
your project type.

### Basic Example

Once set up, write your components naturally:

```jsx
// src/components/Welcome.jsx
function Welcome({ name }) {
  return (
    <div>
      <h1>Welcome to our app!</h1>
      <p>Hello, {name}! How are you today?</p>
      <button>Get started</button>
    </div>
  )
}
```

Extract translatable strings (done automatically when using Vite):

```bash
npx wuchale
```

This generates `.po` files with all your translatable strings, ready for translation.

## How it works

`wuchale` uses static Abstract Syntax Tree (AST) analysis to:

1. **Scan your source code** and identify translatable text content
2. **Extract strings** into standard `.po` translation files
3. **Replace strings** with translation function calls that access the messages by indices
4. **Generate compact catalogs** using arrays instead of string keys, synchronized with the indices

Your original code stays clean and readable, while the build output is automatically internationalized.

## Supported Features

- **Complex interpolations**: `Welcome {userName}, you have {count} messages`
- **Nested markup**: `<p>Visit our <a href="/help">help page</a> for more info</p>`
- **Conditional content**: Handles dynamic content in templates
- **Loop structures**: Automatic extraction from repeated elements
- **Hot Module Replacement**: Live translation updates during development

## Repository structure

This is a monorepo that houses these packages:

- [`wuchale`](https://npmjs.com/package/wuchale): Core + CLI + Vanilla adapter
- [`@wuchale/jsx`](https://npmjs.com/package/@wuchale/jsx): JSX adapter (for React and SolidJS)
- [`@wuchale/svelte`](https://npmjs.com/package/@wuchale/svelte): Svelte adapter
- [`@wuchale/vite-plugin`](https://npmjs.com/package/@wuchale/vite-plugin): The Vite plugin

## Examples

Check out working examples at
**[`wuchalejs/examples`](https://github.com/wuchalejs/examples)** to see
`wuchale` in action with different frameworks.

## 📖 Documentation

See the full guide at: [wuchale.dev](https://wuchale.dev/).

## FAQ

**Q: How does this work without changing my code?**
A: `wuchale` statically analyzes your source code, extracts translatable
strings, and replaces them with translation calls in the compiled output. If
you use Vite, this is done on the fly. If you use the CLI, you can configure it
to output the transformed code to a directory.

**Q: What frameworks and bundlers are supported?**
A: Currently React, Svelte, and SolidJS, plus vanilla JS/TS. And the JSX adapter
can thoretically work with any JSX based library. The core system is
framework-agnostic with specialized adapters for each framework. And Vite is
the only supported bundler. The other way to use it is the CLI.

**Q: Is this compatible with existing translation workflows?**
A: Yes! `wuchale` uses standard `.po` files, so it works with existing
translation tools, services, and workflows.

**Q: What about performance?**
A: Translation catalogs are compiled into very compact modules that only
contain the messages in an array. This gives the smallest possible bundle size
out there. Additionally, interpolations and nested messages are already
prepared for simple concatenation during runtime to avoid complex string
manipulations like replace and regex manipulations, making the runtime very
fast.

## 🤝 Contributing

Contributions are welcome! Please check out our test suites located inside each
package for examples of supported scenarios.

## ❤️ Support & Acknowledgments

> Thank you **[@hayzamjs](https://github.com/hayzamjs)** for making a donation
and using it in [Sylve](https://github.com/AlchemillaHQ/Sylve), and giving
valuable feedback!

If you find `wuchale` valuable and you enjoy working with it, supporting it on
[Github Sponsors](https://github.com/sponsors/K1DV5) or [Open
Collective](https://opencollective.com/wuchale) would mean a lot.

## Inspiration

This project was inspired by [Lingui](https://lingui.dev/) especially some of
its workflow. If you've used Lingui before, you'll find familiar concepts like
extraction and compilation.

`wuchale` takes a different approach: you don't need to change your code,
catalogs compile smaller than any other tool (including Lingui's), and it
integrates with a wider range of frameworks.

## License

[MIT](LICENSE)
