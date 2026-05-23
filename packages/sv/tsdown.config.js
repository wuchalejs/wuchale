import { defineConfig } from 'tsdown'

export default defineConfig({
    entry: ['src/index.ts', 'src/sv-utils.ts'],
    format: 'esm',
})
