// $$ cd .. && npm run test

import { test } from 'node:test'

import { wuchale } from '../dist/index.js'

const plugin = wuchale('./tests/wuchale.config.js')

test('Simple no errors', async (t) => {
    await plugin.configResolved({ env: { DEV: true }, root: './tests' })
})
