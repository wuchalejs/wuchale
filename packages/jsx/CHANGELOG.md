# @wuchale/jsx

## 0.9.2

### Patch Changes

- 12d17f7: Fix inconsistent wuchale versions

## 0.9.1

### Patch Changes

- 3d451d3: Update after fix compiled catalogs writing

## 0.9.0

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

- 37deb80: Removed the `init` CLI command. Loaders are now specified in the config. And they have to export `getRuntime` and `getRuntimeRx`.

  The interactive `init` command was mainly created to scaffold loaders. But
  since most devs don't touch the loaders and since updates to what the loaders
  are expected to export and their locations is not that straightforward to keep
  up with the package updates, the command has been removed, and the loaders can
  be specified in the adapter configuration using the key `loader`.

  The loader config can take some default included loaders and additionally
  `custom` as a value. For example, the Svelte adapter can accept the values
  `svelte`, `sveltekit` and `custom`.

  Specifying the included loaders (`svelte` or `sveltekit` in the example case)
  means you don't want to control their content and want to use the default. And
  so the loader(s) contents are (over)written at dev server startup or the
  `extract` command. That way, they are automatically kept up to date with the
  package. But if you want to do custom stuff with the loaders, and don't want
  them to be overwritten, you can specify `custom`.

  The location of the loaders is next to the catalogs, and follows this naming convention:

  ```
  {adapter key}.loader[.server].{loader extension}
  ```

  For example, for a SvelteKit project, it can be: `main.loader.svelte.js`
  (client) and `main.loader.server.svelte.js` (server). Therefore, if you take
  ownership of these files and do custom stuff, you can specify `custom` in the
  adapter config.

  And next, the (custom) loaders have to export functions `getRuntime` and
  `getRuntimeRx` after wrapping the loaded catalogs with `toRuntime` from
  `wuchale/runtime`.

- 9d1dff8: Add support for translating URL paths!

  This is the biggest addition on this release. Internationalizing URL paths is now possible,
  with the same conveniences of no/minimal code changes, while respecting the fact that URLs
  are to be handled carefully.

  There are two parts to this:

  - Translation: e.g. `/about` to `/uber-uns`
  - Localization: e.g. `/about` to `/en/about`

  Full guide coming soon in the docs!

### Patch Changes

- Updated dependencies [37deb80]
- Updated dependencies [37deb80]
- Updated dependencies [37deb80]
- Updated dependencies [37deb80]
- Updated dependencies [37deb80]
- Updated dependencies [9d1dff8]
  - wuchale@0.18.0

## 0.8.2

### Patch Changes

- a955579: Visit @const declarations in svelte, more compatibility
- Updated dependencies [a955579]
  - wuchale@0.17.4

## 0.8.1

### Patch Changes

- 8e2611d: Export and document all default heuristic functions
- Updated dependencies [6a9b651]
- Updated dependencies [8e2611d]
  - wuchale@0.17.1

## 0.8.0

### Minor Changes

- d531bcc: Add support for multiple custom patterns to support full l10n

  For example, if you want to use [`Intl.MessageFormat`](https://formatjs.github.io/docs/intl-messageformat/) for everything it supports including plurals, you add a signature pattern for a utility function in the config:

  ```js
  // ...
  adapters: js({
    patterns: [
      {
        name: "formatMsg",
        args: ["message", "other"],
      },
    ],
  });
  //...
  ```

  Then you create your reusable utility function with that name:

  ```js
  // where you get the locale
  let locale = "en";

  export function formatMsg(msg, args) {
    return new IntlMessageFormat(msg, locale).format(args);
  }
  ```

  And use it anywhere:

  ```js
  const msg = formatMsg(
    `{numPhotos, plural,
        =0 {You have no photos.}
        =1 {You have one photo.}
        other {You have # photos.}
      }`,
    { numPhotos: 1000 }
  );
  ```

  Then wuchale will extract and transform it into:

  ```js
  const msg = formatMsg(_w_runtime_.t(0), { numPhotos: 1000 });
  ```

### Patch Changes

- 15cf377: Pass whole message to heuristic function, with context
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

## 0.7.4

### Patch Changes

- 9d0acc1: Fix syntax error caused by JSX vs types ambiguity by checking file extension

## 0.7.3

### Patch Changes

- aa6df1e: Fix error on TypeScript in JSX (TSX)

## 0.7.2

### Patch Changes

- b97163a: Don't add a key attribute if there is one already, or if the variant is SolidJS
- Updated dependencies [1d57789]
  - wuchale@0.16.5

## 0.7.1

### Patch Changes

- 5aa768a: Ignore form method attribute and fetch calls
- Updated dependencies [5aa768a]
- Updated dependencies [0352c60]
- Updated dependencies [04e28a3]
  - wuchale@0.16.4

## 0.7.0

### Minor Changes

- fef0d11: Add the `@wc-ignore-file` comment directive

  As an alternative to ignoring a file in the `files` config value, you can now
  ignore a whole file by putting this directive at the beginning of the file,
  before any extractable messages. The advantage is that it doesn't need a
  restart of the dev server and if you rename/move the file it will always be
  ignored.

### Patch Changes

- Updated dependencies [fef0d11]
- Updated dependencies [4fcf264]
- Updated dependencies [46aa3f2]
- Updated dependencies [37367ca]
- Updated dependencies [f07d484]
  - wuchale@0.16.0

## 0.6.3

### Patch Changes

- 3d5d73a: Solve issues with paths on windows
- 10e8b0d: Fix duplicate jsx keys on multiple nested messages
- Updated dependencies [3d5d73a]
  - wuchale@0.15.8

## 0.6.2

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

## 0.6.1

### Patch Changes

- 2a74da7: Fix not all loaders updated for two exports
- Updated dependencies [d03dfa1]
- Updated dependencies [2a74da7]
  - wuchale@0.15.1

## 0.6.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [af21188]
- Updated dependencies [26ce0c3]
  - wuchale@0.15.0

## 0.5.2

### Patch Changes

- 53a8df0: Fix error on attributes without value

## 0.5.1

### Patch Changes

- f5cf428: Fix svelte mixed attributes not handled correctly
- Updated dependencies [2c09872]
- Updated dependencies [f5cf428]
  - wuchale@0.14.2

## 0.5.0

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

### Patch Changes

- 5600e3b: Rename the `NestText` class to `Message` and its `text` attribute to `msgStr`.
- Updated dependencies [5600e3b]
- Updated dependencies [cf92cb5]
- Updated dependencies [c79ae56]
- Updated dependencies [e29bca7]
- Updated dependencies [01af763]
  - wuchale@0.14.0

## 0.4.1

### Patch Changes

- 44ffac1: Fix some files not included

## 0.4.0

### Minor Changes

- e4f601d: Add react default loader
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

### Patch Changes

- Updated dependencies [9fff745]
- Updated dependencies [8ac94b4]
- Updated dependencies [d131ebe]
- Updated dependencies [5531f84]
  - wuchale@0.13.0

## 0.3.0

### Minor Changes

- dcabbe5: Make HMR and common logic universal across adapters

### Patch Changes

- Updated dependencies [dcabbe5]
  - wuchale@0.12.0

## 0.2.0

### Minor Changes

- 406c930: Add JSX adapter

  This change brings JSX support which means it can be used for any framework that uses JSX. First tested with React.
