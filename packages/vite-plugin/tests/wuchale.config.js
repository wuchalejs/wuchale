import { defineConfig } from "wuchale"
import { adapter } from 'wuchale/adapter-vanilla'

export default defineConfig({
    locales: {},
    adapters: {
        main: adapter({
            files: './tests/test-tmp/*.js',
            catalog: './tests/{locale}',
        }),
    }
})
