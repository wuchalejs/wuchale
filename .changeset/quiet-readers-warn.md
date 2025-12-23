---
"@wuchale/vite-plugin": minor
---

Add config update without restarting the dev server (for #208)

Now it's possible to disable and enable
[`hmr`](https://wuchale.dev/reference/config/#hmr) without restarting the dev
server. It relies on Vite's HMR functionality itself (ironic right?). This is
mainly intended to work nicely with other tools, like in #208. You can write
`confUpdate.json` file in `localesDir` describing the intention like:

```sh
echo '{"hmr":false}' > src/locales/confUpdate.json
```

And so for example it can be used in a git hook.
