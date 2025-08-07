# @wuchale/vite-plugin

## 0.10.2

### Patch Changes

- 4d28c2f: Fix error when building caused by no dev server during build

## 0.10.1

### Patch Changes

- 9ef449e: Add readme for vite-plugin

## 0.10.0

### Minor Changes

- 3533ac1: Separate vite plugin into `@wuchale/vite-plugin`

  You have install the new plugin package:

  ```bash
  npm install -D @wuchale/vite-plugin
  ```

  And import the vite plugin from the new package in your `vite.config.*`

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

- c0a307d: Make config path configurable at plugin and cli

  You can now specify another config file you want to use instead of `wuchale.config.js`.
  It still has to be a JavaScript module, but it can be in another directory too.

  And the relative paths specified in the config are relative to the directory
  you run the command from, NOT relative to the file.

### Patch Changes

- Updated dependencies [1d565b4]
- Updated dependencies [830aa1e]
- Updated dependencies [84452f2]
- Updated dependencies [6d37525]
- Updated dependencies [dd4c602]
- Updated dependencies [3533ac1]
- Updated dependencies [d35224f]
- Updated dependencies [9a9aad7]
- Updated dependencies [1d565b4]
- Updated dependencies [a240836]
- Updated dependencies [a6012be]
- Updated dependencies [e9d1817]
- Updated dependencies [3847bc1]
- Updated dependencies [c0a307d]
  - wuchale@0.10.0
