---
"wuchale": patch
---

Fix issues around arrow functions and function expressions

These are technically functions but their bodies are not block statement bodies, but expressions. For this reason, they were ignored when they are defined at the top level and when they are inside functions, they would use the runtime instance of their parent. Now their own bodies are tuned into block statement bodies:

```js
const foo = () => 'Hello'
```

Now becomes:

```js
const foo = () => {
    const _w_runtime_ = _w_to_rt_(_w_load_('main'))
    return _w_runtime_.t(0)
}
```

This allows them to be defined at the top level and they should still get their contents properly extracted.
