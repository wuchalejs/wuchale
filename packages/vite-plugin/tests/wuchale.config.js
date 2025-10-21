import { defineConfig } from "wuchale"
import { adapter } from 'wuchale/adapter-vanilla'

export default defineConfig({
    adapters: {
        main: adapter({
            files: './*.test.js',
            catalog: './tests/test-tmp/{locale}',
            loader: 'server',
        }),
    }
})
