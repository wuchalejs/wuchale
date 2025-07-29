# @wuchale/svelte

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
