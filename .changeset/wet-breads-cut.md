---
"wuchale": patch
---

Fix links with query params and hashes not translated

E.g. `<a href="/home?foo=bar#view">`, now the path is translated and the rest will be preserved
