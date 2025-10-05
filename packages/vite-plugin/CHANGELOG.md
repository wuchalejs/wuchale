# @wuchale/vite-plugin

## 0.14.7

### Patch Changes

- 16b116c: Customizable log levels, add verbose level where all extracted messages are shown
- Updated dependencies [5a221a2]
- Updated dependencies [15cf377]
- Updated dependencies [0b5c207]
- Updated dependencies [16b116c]
- Updated dependencies [22198c1]
- Updated dependencies [6d0a4d3]
- Updated dependencies [d531bcc]
- Updated dependencies [9f997c2]
  - wuchale@0.17.0

## 0.14.6

### Patch Changes

- 973848b: Fix HMR having problems with lazy loaded files
- Updated dependencies [973848b]
  - wuchale@0.16.1

## 0.14.5

### Patch Changes

- Updated dependencies [fef0d11]
- Updated dependencies [4fcf264]
- Updated dependencies [46aa3f2]
- Updated dependencies [37367ca]
- Updated dependencies [f07d484]
  - wuchale@0.16.0

## 0.14.4

### Patch Changes

- 36a2821: Fix windows problems with loader paths

## 0.14.3

### Patch Changes

- 14a1b1f: Revert to manual types for vite plugin to fix build errors

## 0.14.2

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

- Updated dependencies [5ec75dc]
  - wuchale@0.15.4

## 0.14.1

### Patch Changes

- c70b2d7: Fix build error because of type differences

## 0.14.0

### Minor Changes

- af21188: Optional support for separate loader for SSR

### Patch Changes

- Updated dependencies [af21188]
- Updated dependencies [26ce0c3]
  - wuchale@0.15.0

## 0.13.2

### Patch Changes

- 4191ead: Update after moving hmr catalog to handler
- Updated dependencies [2c09872]
- Updated dependencies [f5cf428]
  - wuchale@0.14.2

## 0.13.1

### Patch Changes

- ad84fbb: Fix build error about types

## 0.13.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [5600e3b]
- Updated dependencies [cf92cb5]
- Updated dependencies [c79ae56]
- Updated dependencies [e29bca7]
- Updated dependencies [01af763]
  - wuchale@0.14.0

## 0.12.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [9fff745]
- Updated dependencies [8ac94b4]
- Updated dependencies [d131ebe]
- Updated dependencies [5531f84]
  - wuchale@0.13.0

## 0.11.0

### Minor Changes

- dcabbe5: Make HMR and common logic universal across adapters

### Patch Changes

- Updated dependencies [dcabbe5]
  - wuchale@0.12.0

## 0.10.3

### Patch Changes

- Updated dependencies [6cbece0]
- Updated dependencies [56a350f]
  - wuchale@0.11.0

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
