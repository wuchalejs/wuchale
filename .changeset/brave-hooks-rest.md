---
"wuchale": patch
---

Fix anonymous functions nested in a component or hook being treated as the component itself, which initialized the reactive runtime (a hook call in React) inside callbacks and event handlers
