# wuchale

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
