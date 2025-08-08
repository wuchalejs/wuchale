# @wuchale/svelte

## 0.10.1

### Patch Changes

- Updated dependencies [6cbece0]
- Updated dependencies [56a350f]
  - wuchale@0.11.0

## 0.10.0

### Minor Changes

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

- d35224f: Allow manually selecting loaders on `wuchale init`

  You can now select which default loader you want on init.
  Moreover, it will put the detected one as the first option.

- 1d565b4: Make `bundleLoad` and `initInsideFunc` common options for adapters
- a6012be: Export adapter key for use in loaders

  You can now import the adapter key you set in the config from the proxies
  so that you don't have to manually update them if you change them in the config

  ```js
  import { key } from "virtual:wuchale/proxy";
  ```

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

## 0.9.4

### Patch Changes

- f16ea73: Fix loading not working in vanilla projects
- Updated dependencies [f16ea73]
  - wuchale@0.9.7

## 0.9.3

### Patch Changes

- b350b49: Fix cli init failing with ENOENT
- Updated dependencies [74f50c8]
- Updated dependencies [79fb374]
- Updated dependencies [b350b49]
- Updated dependencies [613f6e7]
- Updated dependencies [2312975]
  - wuchale@0.9.6

## 0.9.2

### Patch Changes

- 2ab4798: Fix `style` tag contents being extracted

## 0.9.1

### Patch Changes

- cd3513a: Fix wrong contents of default loader for svelte

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

### Patch Changes

- Updated dependencies
  - wuchale@0.9.0
