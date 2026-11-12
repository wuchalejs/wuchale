---
"wuchale": patch
---

Reload a catalog changed on disk during dev even when it lands right after one of wuchale's own writes. `git checkout`, `git pull` and `wuchale --clean` change sources and catalogs together, so the old 1-second `hmrDelayThreshold` window mistook their catalog change for wuchale's own write, skipped the reload and later wrote the stale in-memory catalog back over it. Own writes are now recognised by content, and `hmrDelayThreshold` is no longer used.
