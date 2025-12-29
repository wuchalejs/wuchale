import { defineConfig } from "wuchale"
import { adapter } from 'wuchale/adapter-vanilla'

export default defineConfig({
    locales: ['en'],
    adapters: {
        main: adapter({
            files: './*.test.js',
            localesDir: './tests/test-tmp/',
            loader: 'server',
        }),
    }
})
