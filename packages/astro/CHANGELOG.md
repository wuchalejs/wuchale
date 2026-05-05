# @wuchale/astro

## 0.4.0

### Minor Changes

- ⚠️ BREAKING: reorganize loading config, use glob patterns and number load IDs ([#355](https://github.com/wuchalejs/wuchale/pull/355))

  - `granularLoad` is now `loading.granular`
  - `bundleLoad` is now `loading.direct`
  - `generateLoadID` is replaced by a glob config at `loading.group`

  Therefore if you use any of these, update your config like this:

  ```diff
  -import { defineConfig, defaultGenerateLoadID, pofile } from "wuchale"
  +import { defineConfig, pofile } from "wuchale"
  import { adapter as svelte } from '@wuchale/svelte'

  export default defineConfig({
      // ...
      adapters: {
          main: svelte({
              // ...
             bundleLoad: true,
  -          granularLoad: true,
  -          generateLoadID: filename => {
  -              if (filename.includes('grouped')) {
  -                  return 'grouped'
  -              }
  -              return defaultGenerateLoadID(filename)
  -          },
  +          loading: {
  +              granular: true,
  +              direct: true,
  +              group: [
  +                  '**/*grouped*',
  +              ]
  +          }
         }),
      }
  })
  ```

### Patch Changes

- Updated dependencies [[`6d5e244`](https://github.com/wuchalejs/wuchale/commit/6d5e244d9d0744d600d8e15933381934688eaf42)]:
  - wuchale@0.24.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`e5306c2`](https://github.com/wuchalejs/wuchale/commit/e5306c2e62e4da7991dcd067ff28ab165e226ee2), [`2d8462e`](https://github.com/wuchalejs/wuchale/commit/2d8462e9421e9c376a295be464a5d95a3e4ac1c5), [`ba05cf2`](https://github.com/wuchalejs/wuchale/commit/ba05cf22b61fc2ec416c6b26873b79654ed77084)]:
  - wuchale@0.23.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`89fec64`](https://github.com/wuchalejs/wuchale/commit/89fec64579b2c1fe83b0867c5605056f036ce003), [`d53178a`](https://github.com/wuchalejs/wuchale/commit/d53178a7a32a1685bcfdedce8eed0b921b991c89), [`2f195f3`](https://github.com/wuchalejs/wuchale/commit/2f195f39de0902c318efcbf6711beae03070fa3b), [`346f49f`](https://github.com/wuchalejs/wuchale/commit/346f49fd2f2d9ceb244649b77777225ff51de943), [`654b5e9`](https://github.com/wuchalejs/wuchale/commit/654b5e9388b47305c55f90a70002bf79d3af03af), [`85c7473`](https://github.com/wuchalejs/wuchale/commit/85c7473003b25b4fb5656f3680da35b63d174bd9), [`eb49dc8`](https://github.com/wuchalejs/wuchale/commit/eb49dc8f58ba3eed6913048de2c9739b092d524f), [`3371f37`](https://github.com/wuchalejs/wuchale/commit/3371f37e997b160333939b21923bd95b0e6f239f), [`8c9d854`](https://github.com/wuchalejs/wuchale/commit/8c9d8543192a320222c024a5b421d2c63bcd53be), [`b7f362c`](https://github.com/wuchalejs/wuchale/commit/b7f362c43796fae570c0792ed3b443ea4e181313), [`8771568`](https://github.com/wuchalejs/wuchale/commit/87715685e5e758141d4ffc82433217159a65d6f6)]:
  - wuchale@0.22.0

## 0.3.0

### Minor Changes

- Add support for importing a URL localize function from any module at runtime ([`347ca5e`](https://github.com/wuchalejs/wuchale/commit/347ca5e602b5596ed14344bf75f96e47d86effe5))

  This adds support for cases where complete flexibility is needed for URLs, for example
  when the site targets different domain names for different locales, and when one locale
  can be used in different domains. Now a custom localize function that does the localization
  can be implemented, and wuchale only handles the translation. This can be used by providing
  the module path:

  ```js
  export default {
      // ...
      adapters: {
          svelte({
              url: {
                  localize: 'src/lib/url-util.js',
                  patterns: [
                      // ...
                  ]
              }
          })
      }
  }
  ```

  The module has to export a `localize` function that is of type:

  ```ts
  type URLLocalizer = (url: string, locale: string) => string;
  ```

  To just use the default of prefixing the locale to the path, set `localize: true`.

### Patch Changes

- Updated dependencies [[`1dcd46c`](https://github.com/wuchalejs/wuchale/commit/1dcd46c46653779c9ebda59e67b64da97e0c41a9), [`9bb41c5`](https://github.com/wuchalejs/wuchale/commit/9bb41c56a7afc4826c31729224eaa47bf74bed23), [`6e7f373`](https://github.com/wuchalejs/wuchale/commit/6e7f373e0960dbeddd18c525b652618393c4b342), [`e7d8d85`](https://github.com/wuchalejs/wuchale/commit/e7d8d85c811182418aae4618f4f69b87ae8663a0), [`121e98e`](https://github.com/wuchalejs/wuchale/commit/121e98efdd28abb6f1dc3a92e68d6c4e62dba015), [`347ca5e`](https://github.com/wuchalejs/wuchale/commit/347ca5e602b5596ed14344bf75f96e47d86effe5)]:
  - wuchale@0.21.0

## 0.2.8

### Patch Changes

- Updated dependencies [[`8ff01c4`](https://github.com/wuchalejs/wuchale/commit/8ff01c40e6db35e828ea2a06e80e129177da2c3d), [`843544b`](https://github.com/wuchalejs/wuchale/commit/843544beea34494e9e11481add9d5114338a1454), [`69408f9`](https://github.com/wuchalejs/wuchale/commit/69408f96564edbfc8e9c6e2182a6fc5323bdfac3)]:
  - wuchale@0.20.0

## 0.2.7

### Patch Changes

- Fix error on empty file (regression fix) ([`2b1f249`](https://github.com/wuchalejs/wuchale/commit/2b1f249d96517b537fda00550352b18ab6cf4bdd))

- Updated dependencies [[`324fb80`](https://github.com/wuchalejs/wuchale/commit/324fb80cc5d174d7b30ee43d0d704d30516473dc)]:
  - wuchale@0.19.4

## 0.2.6

### Patch Changes

- Fix error when parsing self closing tags in expressions due to astro's limitation ([`1d5ec83`](https://github.com/wuchalejs/wuchale/commit/1d5ec83318aefe6d3d8df73d9a3004d0f8ca7d3a))

## 0.2.5

### Patch Changes

- Fix various parsing errors caused by differences in offset units (bytes in go, indices in js) when files contain unicode characters ([`67c4e82`](https://github.com/wuchalejs/wuchale/commit/67c4e822274592ccc6ce242ce8750f6e932272e9))

## 0.2.4

### Patch Changes

- Allow return outside function for astro frontmatter ([`823f78e`](https://github.com/wuchalejs/wuchale/commit/823f78e8f83174551d5dfb4b125d2934f8b6396d))

- Updated dependencies [[`823f78e`](https://github.com/wuchalejs/wuchale/commit/823f78e8f83174551d5dfb4b125d2934f8b6396d)]:
  - wuchale@0.19.2

## 0.2.3

### Patch Changes

- Fix parsing errors on object attributes, visit spread attributes ([`8fda2a4`](https://github.com/wuchalejs/wuchale/commit/8fda2a470d3dabccce7f45953f0f227c346c44d9))

## 0.2.2

### Patch Changes

- Fix error on empty file ([`3334c2a`](https://github.com/wuchalejs/wuchale/commit/3334c2a9440c83f70ec2bf452e25039c827c77a6))

## 0.2.1

### Patch Changes

- Fix possible infinite retries on ai translate error/mistake ([`2b9a61a`](https://github.com/wuchalejs/wuchale/commit/2b9a61a06bded742d4dcfada843a2a0696c28ade))

- Updated dependencies [[`2b9a61a`](https://github.com/wuchalejs/wuchale/commit/2b9a61a06bded742d4dcfada843a2a0696c28ade)]:
  - wuchale@0.19.1

## 0.2.0

### Minor Changes

- 5f1499b: Add the Astro adapter! Thank you @tarekwiz for starting it!

### Patch Changes

- Updated dependencies [3ca7aac]
- Updated dependencies [9de6b79]
- Updated dependencies [fad845d]
- Updated dependencies [197bb11]
- Updated dependencies [64f7485]
- Updated dependencies [63fb176]
- Updated dependencies [f92c641]
  - wuchale@0.19.0
