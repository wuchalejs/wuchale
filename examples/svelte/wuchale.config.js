import { defineConfig } from "wuchale"
import { adapter } from '@wuchale/svelte'

export default defineConfig({
    locales: {
        // English included by default
        es: { name: 'Spanish' },
        fr: { name: 'French' }
    },
    adapters: {
        main: adapter(),
    }
})
