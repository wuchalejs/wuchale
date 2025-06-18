# wuchale

A non-invasive compile-time internationalization (i18n) system for Svelte —
inspired by Lingui, but built from scratch with performance, clarity, and
simplicity in mind.

> 🌍 Smart translations, tiny runtime, full HMR. `wuchale` extracts your
> strings at build time, generates optimized translation catalogs, supports
> live translations (even from Gemini), and ships almost no extra code to
> production.

## ✨ Features

### 🪄 Invisible Integration

*Write your Svelte code naturally.* — instead of
`<p>{t('Hello')}</p>`, or `<p><Trans>Hello</Trans></p>`, or
`<p>{t(page.home.hello)}</p>`, you write just:

```svelte

<p>Hello</p>

```

No extra imports or annotations. `wuchale` extracts and compiles everything
automatically. In the spirit of Svelte itself.

### 🧠 Compiler-Powered

Built on the Svelte compiler and powered by AST
analysis. All transformations happen at build time using Vite. Runtime is
minimal and constant-time.

### 🧩 Full Nesting Support

Handles deeply nested markup and interpolations — mixed conditionals, loops,
and awaits — by compiling them into nested Svelte snippets. That means you can
go as crazy as
[this test](https://github.com/K1DV5/wuchale/blob/main/tests/complicated/app.svelte)
and it will still extract the correct texts.

### 📦 No String Parsing at Runtime

Messages are compiled into arrays with index-based lookups. Runtime only
concatenates and renders — no regex, replace, or complex logic. And the
compiled bundles are as small as possible, they don't even have keys.

### 🔁 HMR & Dev Translations Live updates during development.

Translation files and source changes trigger updates instantly — including
optional Gemini-based auto-translation. This means you can write the code in
English and have it shown in another language in the browser while in dev mode.

### 🔤 Uses .po Files

Output is standard gettext .po files with references, status tracking, and
optional integration with external tools.

### 🚀 Tiny Footprint

Adds just 2 packages (itself and `pofile`) to `node_modules`, as the other
dependency is Svelte itself. No 200 packages and 90MB dependency trees like
some existing solutions.

### ✨ Ready for Svelte 5

Works with Svelte 5's new architecture and snippets. Future-proof and tightly
integrated

## 🚀 Getting Started

Install:

```bash
npm install wuchale
```

Add to your Vite config:

```javascript

import { svelte } from '@sveltejs/vite-plugin-svelte'
import { wuchale } from 'wuchale'

export default {
    plugins: [
        wuchale(),
        svelte(),
    ]
    // ...your other config
}

```

Create `/locales/` if it doesn't exist, and then set it up in your main
component. Assuming `/src/App.svelte`:

```svelte
import {setTranslations} from 'wuchale/runtime.svelte'

let locale = $state('en')

$effect.pre(() => {
    import(`../locales/${locale}.json`).then(mod => {
        setTranslations(mod.default)
    })
})
```

Note that you manage the state of which locale is active and how to download
the compiled `.json`. This is to allow maximum flexibility, meaning you can use
lazy loading (like this example) or you can import it directly and it will be
bundled by Vite. After that, you notify `wuchale` to set it as the current one.

Then finally you write your Svelte files naturally:

```svelte

<!-- you write -->
<p>Hello</p>

<!-- it becomes -->

<script>
import WuchaleTrans, { wuchaleTrans } from 'wuchale/runtime.svelte'
</script>
<h1>{wuchaleTrans(0)}</h1> <!-- Extracted "Hello" as index 0 -->
```

Full example below.

## 📦 How It Works

### Process

![Diagram](https://raw.githubusercontent.com/K1DV5/wuchale/main/images/diagram.svg)

1. All text nodes are extracted using AST traversal.
1. Replaced with index-based lookups `wuchaleTrans(n)`, which is minifiable for production builds.
1. Catalog is updated
1. If Gemini integration is enabled, it fetches translations automatically.
1. Messages are compiled and written
1. In dev mode: Vite picks the write and does HMR during dev
1. In production mode: unused messages are marked obsolete
1. On next run, obsolete ones are purged unless reused.
1. Final build contains only minified catalogs and the runtime.

### Catalogs:

- Stored as PO files (.po).
- Compatible with tools like Poedit or translation.io.
- Includes source references and obsolete flags for cleaning.

## 🌐 Gemini Integration (optional)

To enable the Gemini live translation, set the environment variable
`GEMINI_API_KEY` to your API key beforehand. The integration is:

- Rate-limit friendly (bundles messages to be translated into one request)
- Only translates new/changed messages
- Keeps original source intact

## 🧪 Example

Input:

```svelte

<p>Hi there!</p>

<p>Hello <b>{userName}</b></p>

```

Output:

```svelte
<script>
import WuchaleTrans, { wuchaleTrans } from 'wuchale/runtime.svelte'
</script>

<p>{wuchaleTrans(0)}</p>

<p>
  {#snippet wuchaleSnippet0(ctx)}
      <b>{ctx[1]}</b>
  {/snippet}
  <WuchaleTrans tags={[wuchaleSnippet0]} id={1} args={[userName]} />
</p>

```

Extracted catalog (PO) for `en`:

```nginx

msgid "Hi there!"
msgstr "Hi there!"

msgid "Hello {0}"
msgstr "Hello {0}"

```

Extracted catalog (PO) for `es`, initially empty `msgstr`, but after a translator or Gemini translates it:

```nginx

msgid "Hi there!"
msgstr "¡Hola!"

msgid "Hello {0}"
msgstr "Hola {0}"

```

Which is then automatically compiled to:

```json
[
    "¡Hola!",
    [
        'Hola ',
        [
            0,
            0
        ]
    ]
]
```

This is what you import when you set it up above in `App.svelte`.

## Supported syntax

Text can be in three places: markup, script and attributes. Script means not
just the part inside the `<script>` tags, but also inside interpolations inside
the markup, such as `<p>{'This string'}</p>` and also in other places such as
`{#if 'this string' == ''}`. And each can have their own rules. While these
rules can be configured, the default is:

- Markup:
    - All text should be extracted unless prefixed with `-`. Example: `<p>-
    This will be ignored.</p>`
- Attributes:
    - All attributes starting with upper case letters are extracted unless
    prefixed with `-` like `label="-Ignore"`.
    - All attributes starting with lower case letters are ignored, unless
    prefixed with `+` like `alt="+extract"`.
- Script:
    - Strings: same rules as attributes above, but:
    - If they are used inside the `<script>` tags, there is the additional
      restriction that they must be inside a `$derived` variable declaration.
      This is to make the behavior less magic and being more explicit.

## Where does it look?

All files that can contain reactive logic. This means `*.svelte` and
`*.svelte.js` files specifically.

## Plurals?

Since messages can be written anywhere in the reactive places, it was not
necessary to have a separate plurals support because you can do something like:

```svelte

<p>{items === 1 ? 'One item listed' : `${items} items listed`}

```

And they will be extracted separately. You can also make a reusable function
yourself.

## 🧹 Cleaning

Unused keys are marked as obsolete during a production build. Obsoletes are
purged on the next run (build or dev). Essentially this means cleaning needs
two passes. This is because of how vite/rollup works.

## 🧪 Tests

A wide range of scenarios are tested, including:

- Raw strings, HTML markup, nested blocks
- Loops, awaits, conditionals
- PO parsing and index consistency
- Obsolete tracking and cleanup

## 📜 License MIT
