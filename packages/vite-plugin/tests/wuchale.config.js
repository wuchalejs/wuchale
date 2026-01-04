import { defineConfig } from 'wuchale'
import { adapter } from 'wuchale/adapter-vanilla'

export default defineConfig({
    locales: ['en'],
    adapters: {
        main: adapter({
            files: './tests/*.test.js',
            localesDir: './tests/test-tmp/',
            loader: 'vite',
        }),
    },
})
