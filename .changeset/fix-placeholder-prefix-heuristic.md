---
"wuchale": minor
---

Extract template literals that start with a placeholder expression followed by natural language content.

Messages like `{0} was successfully deleted!` were previously ignored because
the first character `{` is not a letter. They are now
extracted when the leading placeholder is followed by spaces and letters.
