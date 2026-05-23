export default function wuchalePlainConfig(locales: string[]) {
    return `
// @ts-check
import { adapter as svelte } from "@wuchale/svelte";
import { defineConfig } from "wuchale";

export default defineConfig({
  locales: ${locales},
  adapters: {
    main: svelte({ loader: "svelte" }),
  },
});
`
}
