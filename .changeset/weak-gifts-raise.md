---
"@wuchale/vite-plugin": minor
"wuchale": minor
---

Make config path configurable at plugin and cli

You can now specify another config file you want to use instead of `wuchale.config.js`.
It still has to be a JavaScript module, but it can be in another directory too.

And the relative paths specified in the config are relative to the directory
you run the command from, NOT relative to the file.
