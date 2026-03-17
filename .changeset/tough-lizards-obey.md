---
"wuchale": minor
---

BREAKING: Merge vite plugin logic into core to share with cli

The vite plugin will no longer be a separate package. It is now included in the `wuchale` package.
You should update your vite plugin:

```diff
// vite.config.js
- import {wuchale} from '@wuchale/vite-plugin'
+ import {wuchale} from 'wuchale/vite'
```
