---
"wuchale": patch
---

Fix first build failing when the generated dir doesn't exist yet

`Hub.create` wrote the dev pid file before `initGenDirWithData` created the directory it
lives in, so a build on a tree without `{localesDir}/.wuchale` (which is gitignored, so
any fresh clone or CI checkout) failed with
`ENOENT: no such file or directory, open '.../.wuchale/dev.pid'`.
