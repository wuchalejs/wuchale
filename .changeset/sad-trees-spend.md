---
"wuchale": patch
"@wuchale/svelte": patch
---

Fix and improve default loaders and loader selection

The default suggested loader for the svelte adapter was not reactive to locale changes, now fixed.
Moreover, the default loader selection experience has been improved by removing unnecessary
interations and removing irrelevant choices. For example, there is no need to suggest importing
from a file proxy instead of a virtual module while using the svelte adapter, because vite will be
there anyway because of svelte.
