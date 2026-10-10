---
"wuchale": patch
---

Fix children of a nested element that has no message of its own being compiled as nested, which produced a reference to an undefined `_w_ctx_` and dropped their messages
