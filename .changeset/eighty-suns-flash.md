---
"wuchale": patch
"@wuchale/svelte": patch
"@wuchale/jsx": patch
"@wuchale/vite-plugin": patch
---

Use component in components to preserve non string types

This is mainly relevant to the JSX adapter, where components themselves can be
passed around as values and props, and previously, if they are in expressions
like this:

```jsx
const msg = <b>Hello</b>
return <p>{msg} and welcome</p>
```

The `msg` would be converted into a string and it would become `[object Object]`.

Now this has been fixed.
