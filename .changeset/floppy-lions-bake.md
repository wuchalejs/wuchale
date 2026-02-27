---
"wuchale": minor
---

Add support for keeping whole markups as single units

You can now use the new comment directive:

```svelte
<!-- @wc-unit -->
<div>
    <p>Parag 1</p>
    <p>Parag 2</p>
    <p>Parag 3</p>
</div>
```

And it the whole will be extracted as a single message
