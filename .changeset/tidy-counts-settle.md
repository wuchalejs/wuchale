---
"wuchale": patch
---

Fix messages in functions nested two or more levels deep being counted more than once, which could leave the enclosing function without a runtime initialization and its own messages referencing an undefined `_w_runtime_`
