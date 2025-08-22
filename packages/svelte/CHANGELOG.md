# @wuchale/svelte

## 0.13.2

### Patch Changes

- 808aec6: Preserve using top level `$derived` strings in <script module>s and .svelte.js files for csr only apps

  The difference is that code inside those places only runs once at startup. It
  is okay in client only apps because it can be driven afterwards by state
  changes but it causes a problem in SSR where it only runs at server startup and
  should not be affected by subsequent state changes to not leak info between
  requests, causing a flicker when the specific request's locale is different
  from the one at server startup. To solve this, put translateable strings inside
  function definitions instead of `$derived` so that that function gets executed
  for each request and can get the user's locale. Client only apps are free to
  use either way.

- Updated dependencies [6c459fa]
  - wuchale@0.14.1

## 0.13.1

### Patch Changes

- 80f682f: Fix <script module>s and .svelte.js files not using current locale in SSR

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

### Patch Changes

- 5600e3b: Rename the `NestText` class to `Message` and its `text` attribute to `msgStr`.
- Updated dependencies [5600e3b]
- Updated dependencies [cf92cb5]
- Updated dependencies [c79ae56]
- Updated dependencies [e29bca7]
- Updated dependencies [01af763]
  - wuchale@0.14.0

## 0.12.1

### Patch Changes

- 99e02be: Fix error on SvelteKit SSR load with <script module>s and .svelte.js files

  This was caused when there are <script module>s and `wuchale` would try to
  initialize the runtime instance in them from the load functions which are
  incompatible with <script module>s because they run only once in the server.
  Now it uses AsyncLocalStorage on the server and using `wrapInit` and `wrapExpr`
  to make the runtime instance computed when it is requested instead of once
  initially.

  In `wuchale.config.js`

  ```js
      main: adapter({
          runtime: {
              wrapInit: expr => `() => ${expr}`,
              wrapExpr: expr => `${expr}()`,
          }
      }),
  ```

  And we also need to load the catalogs for the server in `hooks.server.{js,ts}`

  ```js
  import type { Handle } from "@sveltejs/kit";
  import { loadCatalog, loadIDs, key } from "./locales/loader.svelte.js";
  import { runWithLocale, loadLocales } from "wuchale/load-utils/server";

  await loadLocales(key, loadIDs, loadCatalog, ["en", "es", "fr"]);

  export const handle: Handle = async ({ event, resolve }) => {
    const locale = event.url.searchParams.get("locale") ?? "en";
    return await runWithLocale(locale, async () => {
      return await resolve(event, {});
    });
  };
  ```

## 0.12.0

### Minor Changes

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

## 0.11.0

### Minor Changes

- dcabbe5: Make HMR and common logic universal across adapters

### Patch Changes

- Updated dependencies [dcabbe5]
  - wuchale@0.12.0

## 0.10.5

### Patch Changes

- a6746e0: Fix and improve default loaders and loader selection

  The default suggested loader for the svelte adapter was not reactive to locale changes, now fixed.
  Moreover, the default loader selection experience has been improved by removing unnecessary
  interations and removing irrelevant choices. For example, there is no need to suggest importing
  from a file proxy instead of a virtual module while using the svelte adapter, because vite will be
  there anyway because of svelte.

- Updated dependencies [a6746e0]
  - wuchale@0.11.5

## 0.10.4

### Patch Changes

- 1dd1e78: Fix error on init with sveltekit default loader
- a773137: Read package.json to accurately suggest default loaders
- Updated dependencies [a773137]
  - wuchale@0.11.4

## 0.10.3

### Patch Changes

- a367485: Fix error on init loaders
- Updated dependencies [a367485]
  - wuchale@0.11.3

## 0.10.2

### Patch Changes

- e2eb7f4: Fix comments in script not processed correctly
- Updated dependencies [e2eb7f4]
  - wuchale@0.11.1

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
