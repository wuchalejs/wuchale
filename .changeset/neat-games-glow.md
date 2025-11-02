---
"wuchale": minor
---

Provide locale as an rgument option for patterns for easy l10n

You can now use pure functions for l10n like currency and date, etc.

For example, you can define the function:

```js
function currency(num, loc = 'en') {
    return new Intl.NumberFormat(loc, {style: 'currency', currency: 'EUR'}).format(num)
}
```

And specify the pattern in the config:
```js
// ...
    adapters: {
        main: svelte({
            loader: 'sveltekit',
            patterns: [
                {name: 'currency', args: ['other', 'locale']},
            ]
        }),
// ...
```

And when you use it like normal:

```svelte
<p>{currency(123456.789)}</p>
```

It will produce localized variants based on the locale:

- `en`: `€123,456.79`
- `es`: `123.456,79 €`
- `fr`: `123 456,79 €`

You can use it with ANY l10n approach, you just have to specify the pattern.
