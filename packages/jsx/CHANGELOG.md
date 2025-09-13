# @wuchale/jsx

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
