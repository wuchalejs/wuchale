---
"wuchale": minor
---

Gemini: translate in batches of 50 max, auto retry with status messages

This is useful for one off translation, usually just after adding wuchale to a
big project. Gemini sometimes doesn't translate all messages when it's given
too many, so this update batches the messages into groups of ~50, and when not
all of them are translated, shows a message and tries again, until all of them
are translated.
