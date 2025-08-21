---
"@wuchale/vite-plugin": minor
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/jsx": minor
---

Move runtime initialization into the transformed code, framework agnostic HMR

The `Runtime` instance is now initialized inside the transformed code and now
loaders are required to always return a catalog module. This makes all loaders
consistent and makes the `Runtime` an implementation detail. If your loaders
return `new Runtime(catalog)`, you have to unwrap it and return just `catalog`
(or `undefined` in the case of `new Runtime()`). The default loaders are
updated to return the catalog module. If you haven't modified them and want to
use the new ones, you can overwrite them by running `npx wuchale init` and
selecting a loader different from `existing`.

This also solves the problem where HMR may sometimes not work depending on the
method of loading the catalog modules, by avoiding HMR events and the
reactivity from the framework, and just embedding the catalog updates in the
transformed code itself. This also makes it fast as it now doesn't have to wait
for an event from the Vite dev server to update the state. This is only for dev
mode so the production builds still stay lean.

The downside of avoiding using HMR events is that it's now unable to make the
updates from editing the PO files granular and has to do a full reload. But
this is a reasonable tradeoff as editing PO files is not done continuously, but
editing code is.
