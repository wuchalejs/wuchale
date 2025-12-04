# @wuchale/svelte

## 0.17.6

### Patch Changes

- 0a4e3df: Remove surrounding unnecessary quotes when transforming attributes #191
- 885c131: Fix type errors because of generated compiled catalogs not being typed
- Updated dependencies [6af0d52]
- Updated dependencies [0a4e3df]
- Updated dependencies [1b511c3]
- Updated dependencies [5ce8212]
- Updated dependencies [885c131]
  - wuchale@0.18.6

## 0.17.5

### Patch Changes

- f861f78: Use proper hook name to get reactive runtime in React #181
- Updated dependencies [44a6d24]
- Updated dependencies [f861f78]
  - wuchale@0.18.5

## 0.17.4

### Patch Changes

- a1a31f9: Fix errors during build due to granular load IDs and TS types
- Updated dependencies [a1a31f9]
  - wuchale@0.18.3

## 0.17.3

### Patch Changes

- db45dff: Fix default loader templates, remove obsolete comments
- 5b0a570: Fix `custom` loader in config causing errors
- Updated dependencies [4a8ba3d]
- Updated dependencies [db45dff]
- Updated dependencies [5b0a570]
  - wuchale@0.18.2

## 0.17.2

### Patch Changes

- 12d17f7: Fix inconsistent wuchale versions

## 0.17.1

### Patch Changes

- 3d451d3: Update after fix compiled catalogs writing

## 0.17.0

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

## 0.16.6

### Patch Changes

- 5c8cea6: Fix chain expressions (JS) and render tags (Svelte) not being visited
- Updated dependencies [5c8cea6]
  - wuchale@0.17.5

## 0.16.5

### Patch Changes

- d790b4b: Fix auto wrapping exported variables with `$derived` causing errors
- a955579: Visit @const declarations in svelte, more compatibility
- Updated dependencies [a955579]
  - wuchale@0.17.4

## 0.16.4

### Patch Changes

- f18aeda: Fix $state being wrapped in $derived when it has messages

## 0.16.3

### Patch Changes

- 77430e7: Fix error when exporting types from script modules

## 0.16.2

### Patch Changes

- b30885a: Fix `$props` being wrapped in `$derived` when it shouldn't

## 0.16.1

### Patch Changes

- 8e2611d: Export and document all default heuristic functions
- 088c748: Fix errors when exporting snippets with messages
- Updated dependencies [6a9b651]
- Updated dependencies [8e2611d]
  - wuchale@0.17.1

## 0.16.0

### Minor Changes

- 0b5c207: Svelte: auto wrap variable declarations by `$derived` as needed instead of requiring it in the code
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

## 0.15.1

### Patch Changes

- 5aa768a: Ignore form method attribute and fetch calls
- 04e28a3: Fix initialization outside `<script>` when the `<script>` is empty
- Updated dependencies [5aa768a]
- Updated dependencies [0352c60]
- Updated dependencies [04e28a3]
  - wuchale@0.16.4

## 0.15.0

### Minor Changes

- fef0d11: Add the `@wc-ignore-file` comment directive

  As an alternative to ignoring a file in the `files` config value, you can now
  ignore a whole file by putting this directive at the beginning of the file,
  before any extractable messages. The advantage is that it doesn't need a
  restart of the dev server and if you rename/move the file it will always be
  ignored.

### Patch Changes

- b6eb03c: Fix error on interpolations inside <title>
- Updated dependencies [fef0d11]
- Updated dependencies [4fcf264]
- Updated dependencies [46aa3f2]
- Updated dependencies [37367ca]
- Updated dependencies [f07d484]
  - wuchale@0.16.0

## 0.14.3

### Patch Changes

- 3d5d73a: Solve issues with paths on windows
- Updated dependencies [3d5d73a]
  - wuchale@0.15.8

## 0.14.2

### Patch Changes

- 485f5fe: Fix .svelte files with <script module> stuck translatios on SSR
- 8f42073: Fix title element in svelte:head not visited
- Updated dependencies [485f5fe]
  - wuchale@0.15.6

## 0.14.1

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

## 0.14.0

### Minor Changes

- af21188: Optional support for separate loader for SSR
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

## 0.13.5

### Patch Changes

- b2475f0: Fix expression tag attributes not visited
- Updated dependencies [53ee835]
- Updated dependencies [d67de40]
  - wuchale@0.14.6

## 0.13.4

### Patch Changes

- f5cf428: Fix svelte mixed attributes not handled correctly
- Updated dependencies [2c09872]
- Updated dependencies [f5cf428]
  - wuchale@0.14.2

## 0.13.3

### Patch Changes

- d8f72cb: Fix error when parsing <script module>s

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
