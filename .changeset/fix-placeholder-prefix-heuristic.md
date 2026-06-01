---
"wuchale": minor
---

Extract template literals that start with a placeholder expression followed by natural language content.

Strings like `` `${name} was successfully deleted!` `` (compiled to `{0} was successfully deleted!`) were previously ignored by the heuristic because the first character `{` is not a letter. They are now extracted when the leading placeholder is followed by a space or `'s`, which strongly indicates user-facing natural language rather than a structural/technical string.
