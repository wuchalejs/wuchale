---
"wuchale": minor
"@wuchale/svelte": minor
"@wuchale/jsx": minor
---

Add support for multiple custom patterns to support full l10n

For example, if you want to use [`Intl.MessageFormat`](https://formatjs.github.io/docs/intl-messageformat/) for everything it supports including plurals, you add a signature pattern for a utility function in the config:

```js
// ...
adapters: js({
    patterns: [{
        name: 'formatMsg',
        args: ['message', 'other']
    }]
})
//...
```

Then you create your reusable utility function with that name:

```js

// where you get the locale
let locale = 'en'

export function formatMsg(msg, args) {
    return new IntlMessageFormat(msg, locale).format(args)
}
```

And use it anywhere:

```js
const msg = formatMsg(
    `{numPhotos, plural,
      =0 {You have no photos.}
      =1 {You have one photo.}
      other {You have # photos.}
    }`,
    {numPhotos: 1000},
)
```

Then wuchale will extract and transform it into:

```js
const msg = formatMsg(
    _w_runtime_.t(0),
    {numPhotos: 1000},
)
```
