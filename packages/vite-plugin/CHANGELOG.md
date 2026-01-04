# @wuchale/vite-plugin

## 0.16.2

### Patch Changes

- Fix not reloading after po file edit ([`bfb59fc`](https://github.com/wuchalejs/wuchale/commit/bfb59fc11e5344678c9a6fa6bbaa0ba9e50a04a9))

## 0.16.1

### Patch Changes

- 84ca463: Fix type error when `exactOptionalPropertyTypes` is enabled #224

## 0.16.0

### Minor Changes

- 96cd537: Add config update without restarting the dev server (for #208)

  Now it's possible to disable and enable
  [`hmr`](https://wuchale.dev/reference/config/#hmr) without restarting the dev
  server. It relies on Vite's HMR functionality itself (ironic right?). This is
  mainly intended to work nicely with other tools, like in #208. You can write
  `confUpdate.json` file in `localesDir` describing the intention like:

  ```sh
  echo '{"hmr":false}' > src/locales/confUpdate.json
  ```

  And so for example it can be used in a git hook.

- 64f7485: BREAKING: Update locales config to support for 3rd party component libraries

  The `sourceLocale` is now configured on a per-adapter basis, and on the top
  level, all desired `locales` have to be specified.

  You have to make some changes to your config:

  ```diff
   {
  -    sourceLocale: 'en',
  -    otherLocales: ['es', 'fr'],
  +    locales: ['en', 'es', 'fr'],
       adapters: {
           main: svelte({
  +            sourceLocale: 'en',
               // ...
           })
       }
   }
  ```

  Additionally, the `sourceLocale` on the adapter defaults to the first locale in
  the main `locales` array.

  This allows the use of multiple languages in the source code, which may be
  necessary when you are trying to write the source in another language and you
  want to use a 3rd party lib written in English for example.

  And now to use 3rd party component libraries, you can specify the file
  locations in the package dir under `node_modules`:

  ```js
  // wuchale.config.js
  {
    //...
    adapters: {
      lib: svelte({
        files: "node_modules/foo-lib/dist/*.svelte",
      });
    }
  }
  ```

  And additionally, to make sure that Vite doesn't interfere during dev, you can
  exclude the library from startup optimization:

  ```js
  // vite.config.js
  export default defineConfig({
    optimizeDeps: {
      exclude: ["foo-lib"],
    },
  });
  ```

### Patch Changes

- Updated dependencies [3ca7aac]
- Updated dependencies [9de6b79]
- Updated dependencies [fad845d]
- Updated dependencies [197bb11]
- Updated dependencies [64f7485]
- Updated dependencies [63fb176]
- Updated dependencies [f92c641]
  - wuchale@0.19.0

## 0.15.7

### Patch Changes

- ae355a5: Fix windows file path difference preventing hot reload on edit po files
- Updated dependencies [ae355a5]
  - wuchale@0.18.11

## 0.15.6

### Patch Changes

- 9fb85e1: Restrict disabling `hmr` only to dev mode
- Updated dependencies [67655b3]
  - wuchale@0.18.9

## 0.15.5

### Patch Changes

- 7471ce3: Fix translation not showing when writing po file after adding new message in source #204
- Updated dependencies [926aa60]
- Updated dependencies [7471ce3]
  - wuchale@0.18.8

## 0.15.4

### Patch Changes

- 885c131: Fix type errors because of generated compiled catalogs not being typed
- Updated dependencies [6af0d52]
- Updated dependencies [0a4e3df]
- Updated dependencies [1b511c3]
- Updated dependencies [5ce8212]
- Updated dependencies [885c131]
  - wuchale@0.18.6

## 0.15.3

### Patch Changes

- a1a31f9: Fix errors during build due to granular load IDs and TS types
- Updated dependencies [a1a31f9]
  - wuchale@0.18.3

## 0.15.2

### Patch Changes

- 12d17f7: Fix inconsistent wuchale versions

## 0.15.1

### Patch Changes

- 3d451d3: Update after fix compiled catalogs writing

## 0.15.0

### Minor Changes

- 37deb80: Always use physical files, change `catalog` config to `localesDir`

  Previusly virtual modules offered by Vite made it possible to keep the file system
  clean and a slight performance advantage when building, but they had disadvantages:

  - Inspecting what Wuchale generates was not possible unless the `writeFiles` config was enabled
  - They don't work outside of Vite
  - Supporting physical files was therefore unavoidable and that meant supporting two different systems to export the same things

  Now everything is written to disk, including proxies, compiled catalogs, and
  locales data too. And `writeFiles` has been removed. In cases where writing the
  transformed code is desired, the destination can be provided to the `outDir` adapter
  config.

  The second thing is that the location of the catalog files was previusly
  specified using the `catalog` adapter config, which accepted a substitution
  parameter, `{locale}` but it's an unnecessary complexity that can lead to
  problems, and it's not just catalogs that's stored in that location. Therefore,
  it has been replaced by the self descriptive config, `localesDir`.

### Patch Changes

- Updated dependencies [37deb80]
- Updated dependencies [37deb80]
- Updated dependencies [37deb80]
- Updated dependencies [37deb80]
- Updated dependencies [37deb80]
- Updated dependencies [9d1dff8]
  - wuchale@0.18.0

## 0.14.8

### Patch Changes

- 0e3fcd6: Avoid load hook path importer collisions causing problems with vitest

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
