# wuchale

## 0.16.0

### Minor Changes

- fef0d11: Add the `@wc-ignore-file` comment directive

  As an alternative to ignoring a file in the `files` config value, you can now
  ignore a whole file by putting this directive at the beginning of the file,
  before any extractable messages. The advantage is that it doesn't need a
  restart of the dev server and if you rename/move the file it will always be
  ignored.

- 4fcf264: Add support for .mjs config as default
- 46aa3f2: Export locales from proxy when `writeFiles` is enabled for server to not need tweaking the default loader
- 37367ca: Add placeholder context comments into PO file
- f07d484: Gemini: translate in batches of 50 max, auto retry with status messages

  This is useful for one off translation, usually just after adding wuchale to a
  big project. Gemini sometimes doesn't translate all messages when it's given
  too many, so this update batches the messages into groups of ~50, and when not
  all of them are translated, shows a message and tries again, until all of them
  are translated.

## 0.15.8

### Patch Changes

- 3d5d73a: Solve issues with paths on windows

## 0.15.7

### Patch Changes

- 957574f: Fix sequence expressions not visited
- 0223e40: Fix cli with --clean removing all messages not belonging to the last adapter out of those sharing a catalog

## 0.15.6

### Patch Changes

- 485f5fe: Fix .svelte files with <script module> stuck translatios on SSR

## 0.15.5

### Patch Changes

- f698c89: Fix init command ENOENT error when dir doesn't exist

## 0.15.4

### Patch Changes

- 5ec75dc: Use component in components to preserve non string types

  This is mainly relevant to the JSX adapter, where components themselves can be
  passed around as values and props, and previously, if they are in expressions
  like this:

  ```jsx
  const msg = <b>Hello</b>;
  return <p>{msg} and welcome</p>;
  ```

  The `msg` would be converted into a string and it would become `[object Object]`.

  Now this has been fixed.

## 0.15.3

### Patch Changes

- 076dbbc: Fix broken HMR after splitting reactive vs plain

## 0.15.2

### Patch Changes

- bc8a734: Add ssr default loader for vite

## 0.15.1

### Patch Changes

- d03dfa1: Fix error when runtime initialized after non literal expressions
- 2a74da7: Fix not all loaders updated for two exports

## 0.15.0

### Minor Changes

- af21188: Optional support for separate loader for SSR
- 26ce0c3: Separate reactive and plain loader functions

  This is to fix errors happening specifically with React as it doesn't allow
  using hooks inside non hooks or components. But it opens up finer
  configurations for Svelte and SolidJS as well for which the defaults have been
  adjusted as well.

  You can now export different functions from the loader files for reactive (e.g.
  using hooks) and non reactive (e.g. just simple object lookup) and tell
  `wuchale` their names using configuration options, and also adjust which one is
  used when.

  If you want to update your loader(s), you can do `npx wuchale init` and select
  another one than `existing`.

## 0.14.6

### Patch Changes

- 53ee835: Surround object keys only if not computed
- d67de40: Fix error when extracting quoted object key strings

## 0.14.5

### Patch Changes

- 6604274: Fix destructuring assignment default values not extracted

## 0.14.4

### Patch Changes

- 7d8f079: Fix ternary expressions not extracted

## 0.14.3

### Patch Changes

- e7928e9: Fix multiline messages possibly missing catalog checks

## 0.14.2

### Patch Changes

- 2c09872: Trim multiline messages to remove indentation
- f5cf428: Fix svelte mixed attributes not handled correctly

## 0.14.1

### Patch Changes

- 6c459fa: Prevent errors on SSR loading in some cases

  Like with SvelteKit on StackBlitz, it seems it loses the `AsyncLocalStorage`
  context inside the request. But this should't affect normal usage.

## 0.14.0

### Minor Changes

- 5600e3b: Rename the `NestText` class to `Message` and its `text` attribute to `msgStr`.
- cf92cb5: Make runtime error message configurable

  You can now configure the message shown when the message index is not found in
  the compiled catalog array. By default, it is something like `[i18n-404:0]`
  during dev mode and empty `''` in production. You can use the static method at
  startup (anywhere in your app) to override it. It applies globally.

  ```js
  import { Runtime } from "wuchale/runtime";

  Runtime.onInvalid((i, arr) =>
    arr[i] == null ? `not-found:${i}` : `bad:${arr[i]}`
  );
  ```

- c79ae56: Move runtime initialization into the transformed code, framework agnostic HMR

  The `Runtime` instance is now initialized inside the transformed code and now
  loaders are required to always return a catalog module. This makes all loaders
  consistent and makes the `Runtime` an implementation detail. If your loaders
  return `new Runtime(catalog)`, you have to unwrap it and return just `catalog`
  (or `undefined` in the case of `new Runtime()`). The default loaders are
  updated to return the catalog module. If you haven't modified them and want to
  use the new ones, you can overwrite them by running `npx wuchale init` and
  selecting a loader different from `existing`.

  This also solves the problem where HMR may sometimes not work depending on the
  method of loading the catalog modules, by avoiding HMR events and the
  reactivity from the framework, and just embedding the catalog updates in the
  transformed code itself. This also makes it fast as it now doesn't have to wait
  for an event from the Vite dev server to update the state. This is only for dev
  mode so the production builds still stay lean.

  The downside of avoiding using HMR events is that it's now unable to make the
  updates from editing the PO files granular and has to do a full reload. But
  this is a reasonable tradeoff as editing PO files is not done continuously, but
  editing code is.

- e29bca7: Enable sharing catalogs between adapters

  Now you can use the same catalogs with different catalogs and they will work
  with each other on the same file. But they still need different loader files.
  Therefore, A new adapter config option `loaderPath` was added so that different
  loaders can be specified.

- 01af763: Make keeping the existing loader an option instead of a cli flag

  Instead of specifying `--force` in the cli on `npx wuchale init`, if there is
  an existing loader, make it the first option. This makes it easier to update
  the loader if it was the default when a new version comes out.

## 0.13.2

### Patch Changes

- 44b35ac: Fix error for svelte adapter not getting new currentRT

## 0.13.1

### Patch Changes

- e29e69b: Fix errors on vanilla adapter transform and loading

## 0.13.0

### Minor Changes

- 9fff745: Add force flag to init command
- 8ac94b4: Add importName option to adapters

  You can also specify in what name the default export of the loader files is imported.

- d131ebe: Iron out universal HMR, update loaders, organize exports, improve loading reactivity

  This change fixes every small issue with HMR, like editing a file and changing the locale,
  editing the PO file and then the loader file, etc... it should always work as expected now.

  Another thing is that most exports are now from the base `wuchale` package
  except those that may be included in the build outputs of applications which
  should be selectively loaded to improve tree shaking. Most importantly, the loading utilities are now in:

  - `wuchale/load-utils` for client loading
  - `wuchale/load-utils/server` for server loading
  - `wuchale/load-utils/pure` for side effect-free loading

  All of these are optional and if you don't use them, they will not be included in your build.

  The client utility `registerLoaders` function's optional fourth argument is now
  an object with `get` and `set` methods. This allows more control over the state
  of the catalogs for use with the reactivity patterns of any library.

- 5531f84: Add more adapter config options to control runtime

  This brings more options to configure how exactly the runtime instance is
  initialized and used. You can now choose where to initialize it (top level or
  only inside function definitions with certain names), and you can also wrap the
  initialization expression so that you can, for example, put it inside something
  else other than `$derived` in svelte.

## 0.12.1

### Patch Changes

- 430a801: Fix default loaders not included in package

## 0.12.0

### Minor Changes

- dcabbe5: Make HMR and common logic universal across adapters

## 0.11.5

### Patch Changes

- a6746e0: Fix and improve default loaders and loader selection

  The default suggested loader for the svelte adapter was not reactive to locale changes, now fixed.
  Moreover, the default loader selection experience has been improved by removing unnecessary
  interations and removing irrelevant choices. For example, there is no need to suggest importing
  from a file proxy instead of a virtual module while using the svelte adapter, because vite will be
  there anyway because of svelte.

## 0.11.4

### Patch Changes

- a773137: Read package.json to accurately suggest default loaders

## 0.11.3

### Patch Changes

- a367485: Fix error on init loaders

## 0.11.2

### Patch Changes

- 3f4ca05: Fix comments sticking once set

## 0.11.1

### Patch Changes

- e2eb7f4: Fix comments in script not processed correctly

## 0.11.0

### Minor Changes

- 6cbece0: Improve CLI `status` command and structure

  The CLI command `npx wuchale status` is now more powerful and shows more information.
  Also, the stats message printed at dev startup and everytime the .po files change has now been removed.
  Use the CLI to get the status along with numbers.

- 56a350f: Add support for watch mode to CLI

## 0.10.1

### Patch Changes

- 0de92c4: Fix unnecessary 'false' in compiled catalogs when plural rule not included

## 0.10.0

### Minor Changes

- 830aa1e: Add status command, shorten default command to just wuchale

  You can get the new usage by running `npx wuchale --help`.

- 84452f2: Omit plural rules from compiled catalogs if not used
- 6d37525: Show messages in color, improve stats message
- dd4c602: Use consistent name for proxy modules

  You will have to update the imports in your loaders from:

  ```js
  import ... from 'virtual:wuchale/loader'
  // or
  import ... from 'virtual:wuchale/loader/sync'
  ```

  To:

  ```js
  import ... from 'virtual:wuchale/proxy'
  // or
  import ... from 'virtual:wuchale/proxy/sync'
  ```

- 3533ac1: Separate vite plugin into `@wuchale/vite-plugin`

  You have install the new plugin package:

  ```bash
  npm install -D @wuchale/vite-plugin
  ```

  And import the vite plugin from the new package in your `vite.config.*`

- d35224f: Allow manually selecting loaders on `wuchale init`

  You can now select which default loader you want on init.
  Moreover, it will put the detected one as the first option.

- 1d565b4: Make `bundleLoad` and `initInsideFunc` common options for adapters
- a240836: Enforce BCP 47 standard locale identifiers

  If you use simple two-letter identifiers like `en`, this shouldn't make any difference.
  But if you want to use more specific identifiers, you now have to use [BCP 47 standard](https://en.wikipedia.org/wiki/IETF_language_tag).
  That means, `en-US` and `zh-Hant` are valid while `en_US` and `cn-simplified` are not valid.
  The validation is done using Intl.DisplayNames.

- a6012be: Export adapter key for use in loaders

  You can now import the adapter key you set in the config from the proxies
  so that you don't have to manually update them if you change them in the config

  ```js
  import { key } from "virtual:wuchale/proxy";
  ```

- e9d1817: Move the storage of plural rules to PO files and simplify config

  This makes sure that the po files are the single source
  of truth for translations as well as plural rules. The
  translator can update the rules as well. And for the language
  names, Intl.DisplayNames can be used and is more versatile.
  Then the only thing that needs to be specified in the config
  is the codes of the locales, nothing else. This makes the config
  simpler. To update your config, you have to have an array of the
  other locales' codes instead of an object for all locales. English
  will continue to be the `sourceLocale`.

  ```js
  export default {
    otherLocales: ['es', 'fr'],
    adapters: ...
  }
  ```

- 3847bc1: Add `loadLocaleSync` to run-client

  In addition to `loadLocale`, there is now `loadLocaleSync` that can be used with synchronous loaders avoiding `await`.

- c0a307d: Make config path configurable at plugin and cli

  You can now specify another config file you want to use instead of `wuchale.config.js`.
  It still has to be a JavaScript module, but it can be in another directory too.

  And the relative paths specified in the config are relative to the directory
  you run the command from, NOT relative to the file.

### Patch Changes

- 1d565b4: Fix new references not triggering catalog write
- 9a9aad7: Fix errors on immediate access translations after extract during dev

## 0.9.7

### Patch Changes

- f16ea73: Fix loading not working in vanilla projects

## 0.9.6

### Patch Changes

- 74f50c8: Extract from exprs inside non eligible template strings
- 79fb374: Default heuri: extract non top level expression strings
- b350b49: Fix cli init failing with ENOENT
- 613f6e7: - Make vanilla adapter loader conditional on vite for init
  - Import from loader on disk when writing transformed files to disk
- 2312975: Ignore all generated files for extract

## 0.9.5

### Patch Changes

- a109011: Fix error on sveltekit projects, \*.t not function

## 0.9.4

### Patch Changes

- a86f197: fix header rev date updated even when no changes

## 0.9.3

### Patch Changes

- 209fb51: Fix locale changes not being reactive in .svelte.js/ts files

## 0.9.2

### Patch Changes

- 7ef6ea5: Fix bare strings in the top level being extracted

## 0.9.1

### Patch Changes

- 3cb0541: Fix wrong default loader contents for vanilla adapter

## 0.9.0

### Minor Changes

- - Non-Vite normal Node.js javascript usage with just CLI, like a compiler
  - Write transformed files to file
  - Multiple adapter specifications with different configurations
    - Enabled full client and server messages i18n support
  - Can now specify different loading behaviours for compiled catalogs
    - Lazy, shared between files
    - Granular, loaded in groups
    - Granular, loaded separately
    - Granular, bundled
    - Custom (with provided primitives)
  - Support custom ID generator for granular loading to enable selective grouping
  - More information provided to heuristic function
