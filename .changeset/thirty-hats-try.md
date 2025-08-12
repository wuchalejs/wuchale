---
"wuchale": minor
"@wuchale/jsx": minor
"@wuchale/svelte": minor
---

Add more adapter config options to control runtime

This brings more options to configure how exactly the runtime instance is
initialized and used. You can now choose where to initialize it (top level or
only inside function definitions with certain names), and you can also wrap the
initialization expression so that you can, for example, put it inside something
else other than `$derived` in svelte.
