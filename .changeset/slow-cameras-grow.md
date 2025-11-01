---
"wuchale": minor
---

Require running `npx wuchale` before build for deterministic builds

This solves the problem where you start the build process with some messages in
the code not yet extracted to the PO files, and are discovered during the build
process, which causes the PO file and subsequently the compiled catalogs to be
modified, during build. That causes a race condition and makes the build
process fail because of a syntax error (the compiled catalog is read while only
half of it is written.)

Additionally, with the new URL handling, links are not directly translated,
their translation is derived from the URL pattern translations. That removed
the need to store them in the PO files, just the patterns. But that also means
they are not known at the start of the build process, which causes the above
problem.

Now, during build, no PO file writes or compiles are performed, only code
transformations happen, and the compiled outputs from a previous `npx wuchale`
are used. This makes builds faster and deterministic.

During dev mode, however, all of them will continue to work, because dev mode
is relaxed and wuchale can notify when there is a change. Same DX will continue.
