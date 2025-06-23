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

> They say "i18n is too costly to add later"

✨ **Not anymore**. wuchale brings i18n to existing Svelte projects — the UX-first way.

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

### 🔁 Optional HMR & Dev Translations Live updates during development.

Translation files and source changes can trigger updates instantly — including
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

Works with Svelte 5's new architecture with runes and snippets. Future-proof
and tightly integrated

## 🚀 Getting Started

### Installation

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

### Configuration

To configure `wuchale`, you can do one of:

- Pass an object `wuchale()` in your `vite.config.js` `vite.config.ts`
- Create a `wuchale.config.js` file that exports the config object as `default` in your project root directory.

But the latter is recommended as it is also read when using the CLI command to extract items.

The config object should look like the following (the default):

```javascript
export const defaultOptions: Config = {
    sourceLocale: 'en',
    otherLocales: [],
    localesDir: './src/locales',
    srcDirs: ['src'],
    heuristic: defaultHeuristic,
    hmr: true,
    geminiAPIKey: 'env',
}
```

Note that you have to provide `otherLocales`, otherwise it doesn't have any
effect.

While the others are self explanatory, the `heuristic` is a function that
globally decides what text to extract and what not to. The `defaultHeuristic`
is the implementation of the default rules explained below, but you can roll
your own and provide it here. The function should receive the following
arguments:

- `text`: The candidate text
- `scope`: Where the text is located, i.e. it can be one of `markup`, `script`, and `attribute`

And it should return boolean to indicate whether to extract it.

The `hmr` can be used to turn off the live updates during dev. It will disable
all text extraction from source files and modification of the `.po` files as
you modify the source files. This may be desired because the language files are
imported by the top components and frequent modification of the language files
can trigger big updates of the DOM, which may cause states not depending on the
URL to be lost. If you choose to disable the `hmr` extraction, you can still
extract (and translate with Gemini) using the CLI command.

### Setup

Create `/src/locales/` (or the directory you set up in the configuration,
relative to the projects root) if it doesn't exist, and then set it up in your
main component. How you set it up depends on whether you use SvelteKit or not.

#### SvelteKit

If you use SvelteKit you likely use SSR/SSG too. And this is how you make
`wuchale` work with SSR/SSG. If you instead want to use normal client side
state for the locale, feel free to adapt the method explained below for Svelte.

You have to put the following in yout top load function. Taking
the default template as an example, the main load function would be inside
`src/routes/+page.js`. Have the following content in it (TypeScript):

```typescript
import { setTranslations } from 'wuchale/runtime.svelte.js'

interface Params {
    url: URL,
}

export async function load({ url }: Params): Promise<{}> {
    const locale = url.searchParams.get('locale') ?? 'es'
    // IMPORTANT! The path should be relative to the current file
    const mod = await import(`../locales/${locale}.js`)
    setTranslations(mod.default)
    return {}
}
```

What it does is it makes the locale dependent on the URL search param `locale`
and loads the appropriate language js based on it. You can now adapt it to
any state such as the `[locale]` slug in the URL path based on your own needs.

Now you can start the dev server and see it in action. You can change the URL
search params like `?locale=es` (if you set up `es` in `otherLocales`)

#### Svelte

For Svelte you can set up lazy loading and code splitting (recommended). Taking
the default template as an example, the main component is located in
`src/App.svelte`.

```svelte
<script>
    import {setTranslations} from 'wuchale/runtime.svelte.js'

    let locale = $state('en')

    $effect.pre(() => {
        // IMPORTANT! The path should be relative to the current file (vite restriction).
        import(`../locales/${locale}.js`).then(mod => {
            setTranslations(mod.default)
        })
        // but this only applies if you want to do lazy loading.
        // Otherwise you can do an absolute import
    })
</script>
```

Note that you manage the state of which locale is active and how to download
the compiled `.js`. This is to allow maximum flexibility, meaning you can use
lazy loading (like this example) or you can import it directly and it will be
bundled by Vite. After that, you notify `wuchale` to set it as the current one.

Then finally you write your Svelte files naturally.

## 🧪 Example

Input:

```svelte

<p>Hi there!</p>

<p>Hello <b>{userName}</b></p>

```

Output:

```svelte
<script>
    import {wuchaleTrans} from "wuchale/runtime.svelte.js"
    import WuchaleTrans from "wuchale/runtime.svelte"
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

```javascript
export default [
    "¡Hola!",
    [
        "Hola ",
        [
            0,
            0
        ]
    ]
]
```

This is what is included in the imported module above in `+page.ts` or `App.svelte`.

## 📦 How It Works

### Process

![Diagram](https://raw.githubusercontent.com/K1DV5/wuchale/main/images/diagram.svg)

1. All text nodes are extracted using AST traversal.
1. Replaced with index-based lookups `wuchaleTrans(n)`, which is minifiable for production builds.
1. Catalog is updated
1. If Gemini integration is enabled, it fetches translations automatically.
1. Messages are compiled
1. In dev mode: Vite picks the write and does HMR during dev
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

## Supported syntax

Text can be in three places and the probability of the text inside them being
intended is different for each of them. Therefore, a global heuristic function
is applied to check whether the text should be extracted depending on each
case, discussed below. And for specific granular control, comments can be used,
like for typescript: `@wc-ignore` and `@wc-include`.

### Markup

Markup means text that we write inside tags like in paragraphs. This is almost
always intended to be shown to the user. Therefore, the default global rule is
to extract all text inside the markup, with the ability to force ignore with a
comment:

```svelte
<p>This is extracted</p>
<!-- @wc-ignore -->
<p>This is ignored</p>
```

### Attributes

Attributes are the text that are literally written like `class="this"`. Dynamic
attributes are not considered for this rule, instead they follow the script
rule below, because they are JS expressions. For text attributes, the default
rule is that all text starting with a capital letter is extracted.
Example:

```svelte
<p class="not-extracted" title="Extracted">
    This is extracted
</p>
```

For ignoring or force-including, convert them to expressions and follow the
script rule below.

### Script

This includes all JS/TS code that is:

- Inside `<script>` tags
- Inside dynamic expressions inside the markup or attributes, anything in curly braces like `{call('this guy')}`
- In `*.svelte.[js|ts]` files.

The rule for this is that all strings and template strings that start with
capital letters are extracted. Additionally, if they are used inside the
`<script>` tags and in their own files (third case above), there is the
additional restriction that they must be inside a `$derived` or `$derived.by`
variable declaration. This is to make the behavior less magic and being more
explicit. Example:

```svelte
<script>
    const a = 'Not extracted'
    const b = $derived('not extracted either')
    const c = $derived('This one is extracted')
    const d = $derived(`This one as well ${a} - ${b}`)
    const d = $derived(/* @wc-include */ `${a} - ${b} this is force extracted`)
</script>

<p class={/* @wc-ignore */ `Ignore${3}`} title={'Included'} >Normal text</p>

```

## Context?

Sometimes we need to have different translations that are the same text in the
source language. For that, the comment directive `@wc-context:` is provided and
they will be separate.

```svelte
<b>
    <!-- @wc-context: machine -->
    Maintenance
</b>
<i>Is different from</i>
<b>
    <!-- @wc-context: beauty -->
    Maintenance
</b>
```

Excuse my poor example choice.

## Plurals?

Since messages can be written anywhere in the reactive places, it was not
necessary to have a separate plurals support because you can do something like:

```svelte

<p>{items === 1 ? 'One item listed' : `${items} items listed`}

```

And they will be extracted separately. You can also make a reusable function
yourself.

## CLI

A simple command line interface is also provided, just `wuchale` with an optional `--clean` argument.

By default, it looks inside all svelte sources and extracts new texts into the
`.po` files. If the `--clean` argument is provided, it additionally removes
unused texts from the `.po` files.

## Files management

`wuchale` generates two files for each locale.

### `.po` file

This is a `gettext` file that is used to exchange the text fragments with translators. The workflow is:

- You give them the file with empty places for the translated fragments
- They fill it with the translation, preserving the placeholders, but they can change the orders as the language requires.
- You get the file back and make it part of your codebase.

**Note**: You should commit these files, they are where the translated
fragments are stored and are the source of truth for the translations.

### Compiled data in `.js` file

This is the module that imports the compiled version of the `.po` file. It is
generated at the startup of the dev server and at build time. As can be
generated every time, you should consider it as a temp file and therefore you
should not commit it.

## 🧪 Tests

A wide range of scenarios are tested, including:

- Raw strings, HTML markup, nested blocks
- Loops, awaits, conditionals
- PO parsing and index consistency
- Obsolete tracking and cleanup

## 📜 License MIT
