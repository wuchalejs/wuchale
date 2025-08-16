---
"@wuchale/svelte": patch
---

Fix error on SvelteKit SSR load with <script module>s and .svelte.js files

This was caused when there are <script module>s and `wuchale` would try to
initialize the runtime instance in them from the load functions which are
incompatible with <script module>s because they run only once in the server.
Now it uses AsyncLocalStorage on the server and using `wrapInit` and `wrapExpr`
to make the runtime instance computed when it is requested instead of once
initially. 

In `wuchale.config.js`

```js
    main: adapter({
        runtime: {
            wrapInit: expr => `() => ${expr}`,
            wrapExpr: expr => `${expr}()`,
        }
    }),
```

And we also need to load the catalogs for the server in `hooks.server.{js,ts}`

```js
import type { Handle } from '@sveltejs/kit';
import { loadCatalog, loadIDs, key } from './locales/loader.svelte.js'
import { runWithLocale, loadLocales } from 'wuchale/load-utils/server';

await loadLocales(key, loadIDs, loadCatalog, ['en', 'es', 'fr'])

export const handle: Handle = async ({ event, resolve }) => {
    const locale = event.url.searchParams.get('locale') ?? 'en';
    return await runWithLocale(locale, async () => {
        return await resolve(event, {})
    })
};
```
