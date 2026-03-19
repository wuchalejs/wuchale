---
"wuchale": minor
---

Add support for JSON output on `status` command

The command `npx wuchale status` now accepts the `--json` flag and can print
the info in a structured JSON format. This can be used to use for e.g. to check
the number of untranslated items using `jq` in CI etc.
