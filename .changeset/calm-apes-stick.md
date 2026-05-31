---
"wuchale": minor
---

⚠️ BREAKING: Replace `outDir` config on adapters with CLI flag `--modify`

If you want to write the transformed files back to disk, you can specify the
flag in the CLI, `npx wuchale --modify {adapter1},{adapter2},...` and the files
for those adapters will be modified in-place. This OVERWRITES the files,
therefore only use it when you are certain, and have Git already setup and in a
clean state, so that you can restore them. Normally you should use it only to
when you use an unsupported bundler and in that case you should only run it in
CI just before deployment. Or you can use it for debugging (and restore with
Git.)
