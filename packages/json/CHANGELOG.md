# @wuchale/json

## 0.2.1

### Patch Changes

- Updated dependencies [[`3c88ee9`](https://github.com/wuchalejs/wuchale/commit/3c88ee9b475b83b654aaf0fe6c07a31edc8f6387)]:
  - wuchale@0.25.0

## 0.2.0

### Minor Changes

- ⚠️ BREAKING: Composable storage: `dir` config in `pofile` and `json` storage changed to `location`, `separateUrls` removed. ([#382](https://github.com/wuchalejs/wuchale/pull/382))

  The `dir` config which was used to set the directory under which to save
  catalog storages is now replaced by `location` which gives more control. In
  `pofile` it should be a file path pattern with `{locale}` as a placeholder. If
  you use `separateUrls` (which was `true` by default), you should now use the
  new `storageByType` layer:

  ```diff
  -import { pofile } from 'wuchale'
  +import { pofile, storageByType } from 'wuchale'

  export default {
      // ...
      adapters: {
          main: svelte({
              // ...
  -            storage: pofile({dir: 'src/locales'}),
  +            storage: storageByType({
  +                message: pofile({location: 'src/locales/{locale}.po'}),
  +                url: pofile({location: 'src/locales/{locale}.url.po'})
  +            }),
          }),
      }
  }
  ```

  `storageByType` returns a storage itself, but if you don't need to separate the
  items, you can opt not to use it. But it also opens the possibility of storing
  URL translations in another format for example.

### Patch Changes

- Include placeholders in nested messages also indicating nesting like `0.0.1` ([`2005ea1`](https://github.com/wuchalejs/wuchale/commit/2005ea1968291fb4a3f72af098ff72d31baa9ab6))

- Updated dependencies [[`2005ea1`](https://github.com/wuchalejs/wuchale/commit/2005ea1968291fb4a3f72af098ff72d31baa9ab6), [`89b650b`](https://github.com/wuchalejs/wuchale/commit/89b650b49b3cb8f12cb631ce0b7a79c84bc5e548), [`94ce7fc`](https://github.com/wuchalejs/wuchale/commit/94ce7fcaa173c7dcdfe742ee332b0f6ab242673f), [`4899ae6`](https://github.com/wuchalejs/wuchale/commit/4899ae6242b96161ce8f6a8db46a11de8ad1f698), [`f903655`](https://github.com/wuchalejs/wuchale/commit/f9036553d60577d5a7875f517ec3a59cca888dd8), [`4bbbbae`](https://github.com/wuchalejs/wuchale/commit/4bbbbae9adcc9dffbd43f3f76a02c63b882d3b22), [`589fbca`](https://github.com/wuchalejs/wuchale/commit/589fbca44fcfd4253e8077d1f2b6b3469d4629cc), [`4922b03`](https://github.com/wuchalejs/wuchale/commit/4922b0372d230d76e9e1777380d5d0ba55a536f9), [`3567c7f`](https://github.com/wuchalejs/wuchale/commit/3567c7ffb4df43f070e065f52318f6cf86e0ebc0), [`2521033`](https://github.com/wuchalejs/wuchale/commit/25210330c22b22e12a2984a9b6fa7dcba4a657d7), [`5063533`](https://github.com/wuchalejs/wuchale/commit/5063533dbe518e0ffb3b105e035253801625d19e), [`6d5e244`](https://github.com/wuchalejs/wuchale/commit/6d5e244d9d0744d600d8e15933381934688eaf42)]:
  - wuchale@0.24.0

## 0.1.1

### Patch Changes

- Add a customizable JSON storage handler, `@wuchale/json` ([#304](https://github.com/wuchalejs/wuchale/pull/304))

- Updated dependencies [[`e5306c2`](https://github.com/wuchalejs/wuchale/commit/e5306c2e62e4da7991dcd067ff28ab165e226ee2), [`2d8462e`](https://github.com/wuchalejs/wuchale/commit/2d8462e9421e9c376a295be464a5d95a3e4ac1c5), [`ba05cf2`](https://github.com/wuchalejs/wuchale/commit/ba05cf22b61fc2ec416c6b26873b79654ed77084)]:
  - wuchale@0.23.0
