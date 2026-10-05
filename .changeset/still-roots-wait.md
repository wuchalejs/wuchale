---
"wuchale": patch
---

Fix messages outside of any function being transformed when the runtime cannot be initialized at the top level (e.g. module-level JSX in React), which left them referencing an undefined `_w_runtime_`
