---
"wuchale": patch
---

Fix crash when collecting assignment names from destructuring patterns

`getAssignmentNames` was passed unbound to `flatMap`, so `this` was `undefined` in the
callback and any pattern that recursed threw
`TypeError: Cannot read properties of undefined (reading 'getAssignmentNames')`. This hit
rest elements and nested patterns, e.g. the common
`let { class: className, ...rest } = $props()`.

Object patterns also silently resolved to no names, because `ObjectPattern.properties`
yields `Property` nodes and there was no branch for them. They now recurse into
`property.value`, so assignment targets (used by `ignoreAssign` and nested message naming)
are resolved for destructured declarations.
