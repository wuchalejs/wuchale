<p align="center">
    <a href="https://wuchale.dev/">
        <img width="180" src="https://raw.githubusercontent.com/wuchalejs/wuchalejs.github.io/main/public/favicon.svg" alt="wuchale logo">
    </a>
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/wuchale"><img src="https://img.shields.io/npm/v/wuchale?logo=npm&logoColor=red&color=blue" alt="npm package"></a>
  <a href="https://github.com/wuchalejs/wuchale/actions/workflows/ci.yml"><img src="https://github.com/K1DV5/wuchale/actions/workflows/ci.yml/badge.svg?branch=main" alt="build status"></a>
  <a href="https://pr.new/wuchalejs/wuchale"><img src="https://developer.stackblitz.com/img/start_pr_dark_small.svg" alt="Start new PR in StackBlitz Codeflow"></a>
  <a href="https://wuchale.dev/chat"><img src="https://img.shields.io/badge/chat-discord-blue?style=flat&logo=discord" alt="discord chat"></a>
</p>
<br/>

# 📜`wuchale`🪶

**`wuchale`** (pronounced "wuh-cha-lay") is a compile-time internationalization
toolkit that requires no code changes. Write your components naturally, and
`wuchale` automatically extracts and replaces translatable messages at build
time.

- **🧼 No extra syntax!** - Your normal code is enough, your codebase stays clean
- **📦 Tiny catalogs to bundle** - Text catalogs are just arrays, no keys necessary, like Protobuf
- **🔌 Zero-effort integration** - Add i18n to existing projects without rewriting code
- **🧩 Framework agnostic** - Works with React, Preact, Svelte(Kit), SolidJS, Astro, and plain JS/TS
- **✨ Optional AI translation** - Configurable integration for automatic on-the-fly translations
- **⚡ Full, granular HMR support** - Live updates during development, including AI auto-translation
- **📦 Tiny footprint** - Very few (less than 5) additional dependencies, no bloated `node_modules`
- **🧠 Smart extraction** - Uses AST analysis to handle nested markup, conditionals, loops, and complex interpolations
- **🌍 Standard .po files** - Compatible with existing translation tools and workflows

## A taste

With traditional i18n:

```svelte
<p>{t('Hello')}</p>
<p><Trans>Welcome {userName}</Trans></p>
```

With `wuchale`:

```svelte
<p>Hello</p>
<p>Welcome {userName}</p>
```

No imports, no wrappers, no annotations. `wuchale` handles everything at
compile time by analyzing your code and automatically extracting translatable
strings.

## Getting started

See the [Getting Started guide](https://wuchale.dev/intro/start/) for
instructions specific to your project type.

## How it works

1. **Scans your source code** using AST and identify translatable text content
2. **Extracts strings** into standard `.po` translation files for translators
3. **Compiles catalogs** into compact modules which export arrays
4. **Replaces strings** with translation function calls that access messages by indices from the arrays

Your original code stays clean and readable, while the build output is automatically internationalized.

## Example

Let's say you have:

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

The messages are extracted into a `.po` file. for Spanish for example, after translation, it looks like:

```po
#~ src/components/Welcome.jsx
msgid "Welcome to our app!"
msgstr "¡Bienvenido a nuestra aplicación!"

#~ src/components/Welcome.jsx
msgid "Hello, {0}! How are you today?"
msgstr "¡Hola, {0}! ¿Cómo estás hoy?"

#~ src/components/Welcome.jsx
msgid "Get started"
msgstr "Comenzar"
```

Then they are compiled into a compact form optimized for loading (just an array):

```js
export let c = ["¡Bienvenido a nuestra aplicación!",["¡Hola, ",0,"! ¿Cómo estás hoy?"],"Comenzar"]
```

And your code is transformed into a version that accesses them by index:

```jsx
// src/components/Welcome.jsx
import { _load_ } from '../locales/loader.js'

function Welcome({ name }) {
  const _w_runtime_ = _load_('main')
  return (
    <div>
      <h1>{_w_runtime_(0)}</h1>
      <p>{_w_runtime_(1, [name])}</p>
      <button>{_w_runtime_(2)}</button>
    </div>
  )
}
```

Check out full working examples for different setups at
**[`wuchalejs/examples`](https://github.com/wuchalejs/examples)** to see
`wuchale` in action with different frameworks.

## Supported Features

- **Complex interpolations**: `Welcome {userName}, you have {count} messages`
- **Nested markup**: `<p>Visit our <a href="/help">help page</a> for more info</p>`
- **Conditional content**: Handles dynamic content in templates
- **Loop structures**: Automatic extraction from repeated elements
- **URLs**: E.g. `/about` to `/de/uber-uns`
- **Hot Module Replacement**: Live translation updates during development

## Repository structure

This is a monorepo that houses these packages:

| Package    | Description | Latest |
| -------- | ------- | --- |
| `wuchale`  | Core + CLI + Vanilla adapter    |[![wuchale](https://img.shields.io/npm/v/wuchale?logo=npm&logoColor=red&color=blue")](https://npmjs.com/package/wuchale) |
| `@wuchale/jsx` | JSX adapter (for React and SolidJS)     |[![@wuchale/jsx](https://img.shields.io/npm/v/@wuchale/jsx?logo=npm&logoColor=red&color=blue")](https://npmjs.com/package/@wuchale/jsx)|
| `@wuchale/svelte`    | Svelte adapter    |[![@wuchale/svelte](https://img.shields.io/npm/v/@wuchale/svelte?logo=npm&logoColor=red&color=blue")](https://npmjs.com/package/@wuchale/svelte)|
| `@wuchale/astro`    | Astro adapter    |[![@wuchale/astro](https://img.shields.io/npm/v/@wuchale/astro?logo=npm&logoColor=red&color=blue")](https://npmjs.com/package/@wuchale/astro)|
| `@wuchale/vite-plugin`    | The Vite plugin    |[![@wuchale/vite-plugin](https://img.shields.io/npm/v/@wuchale/vite-plugin?logo=npm&logoColor=red&color=blue")](https://npmjs.com/package/@wuchale/vite-plugin)|

## 🤝 Contributing

Contributions are welcome! Please check out the test suites located inside each
package for examples of supported scenarios.

## ❤️ Sponsors

This project is supported by the community. Become a sponsor and get your name
or logo listed here!

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor%20on-GitHub-%23ea4aaa?logo=github&logoColor=white)](https://github.com/sponsors/K1DV5)
[![Donate on Open Collective](https://img.shields.io/badge/Donate%20on-Open%20Collective-%230092e6?logo=opencollective&logoColor=white)](https://opencollective.com/wuchale)

Special thanks to our supporters:

[![hayzamjs](https://avatars.githubusercontent.com/u/3922884?v=4&size=48)](https://github.com/hayzamjs)
[![p-mercury](https://avatars.githubusercontent.com/u/9084532?v=4&size=48)](https://github.com/p-mercury)
[![perdix](https://avatars.githubusercontent.com/u/1526654?v=4&size=48)](https://github.com/perdix)

And one private donor 🙏.

## Inspiration

This project was inspired by [Lingui](https://lingui.dev/) especially some of
its workflow. If you've used Lingui before, you'll find familiar concepts like
extraction and compilation.

Where `wuchale` differs, among other things, is that you don't need to change your
code, catalogs compile smaller than any other tool (including Lingui's), and it
integrates with a wider range of frameworks.

## License

[MIT](LICENSE)
