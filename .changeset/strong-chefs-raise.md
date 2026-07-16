---
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/astro": minor
"@wuchale/jsx": minor
---

!Replace single details object with an array of scope objects and separate filename for heuristic

The heuristic function now gets called with two arguments: the extracted `Text` object, and the filename as a `string` argument. The `Text` object now has:

- `.body: string | string[]` instead of `Message.msgStr`
- `.path: Scope[]` instead of `Message.details` - this is an array of different small `Scope` objects that better conveys nesting information.
- The rest of the properties are the same as `Message`

Therefore if you implement a custom heuristic function you should for example:

```diff
-heuristic: (msg) => {
+heuristic: (text, file) => {
-    if (msg.details.element || msg.details.file.endsWith('.foo')) {
+    if (text.path.some(s => s.type === 'element') || file.endsWith('.foo')) {
         return false
     }
 }
```

The scope array is now used to ignore whole sub-trees of ignored elements even if they contain non-ignored elements.
