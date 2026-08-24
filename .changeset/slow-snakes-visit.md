---
"@wuchale/astro": minor
---

Add proper Astro integration that simplifies config
  
There is now a proper Astro integration instead of using the Vite plugin in the
Astro config and configuring additional things. You can now just have

```js
// astro.config.mjs
import { wuchale } from '@wuchale/astro/integration'
import { defineConfig } from 'astro/config'

export default defineConfig({
    integrations: [wuchale()]
});
```
