# wuchale

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
