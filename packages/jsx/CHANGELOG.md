# @wuchale/jsx

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
