---
"wuchale": minor
---

Make keeping the existing loader an option instead of a cli flag

Instead of specifying `--force` in the cli on `npx wuchale init`, if there is
an existing loader, make it the first option. This makes it easier to update
the loader if it was the default when a new version comes out.
