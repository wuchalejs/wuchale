---
"wuchale": minor
---

Enforce BCP 47 standard locale identifiers

If you use simple two-letter identifiers like `en`, this shouldn't make any difference.
But if you want to use more specific identifiers, you now have to use [BCP 47 standard](https://en.wikipedia.org/wiki/IETF_language_tag).
That means, `en-US` and `zh-Hant` are valid while `en_US` and `cn-simplified` are not valid.
The validation is done using Intl.DisplayNames.
