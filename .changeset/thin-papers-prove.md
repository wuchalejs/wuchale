---
"@wuchale/svelte": patch
---

Preserve using top level `$derived` strings in <script module>s and .svelte.js files for csr only apps

The difference is that code inside those places only runs once at startup. It
is okay in client only apps because it can be driven afterwards by state
changes but it causes a problem in SSR where it only runs at server startup and
should not be affected by subsequent state changes to not leak info between
requests, causing a flicker when the specific request's locale is different
from the one at server startup. To solve this, put translateable strings inside
function definitions instead of `$derived` so that that function gets executed
for each request and can get the user's locale. Client only apps are free to
use either way.
