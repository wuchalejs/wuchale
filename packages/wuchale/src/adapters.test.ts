// $ node --import ../testing/resolve.ts %f

import { test } from 'node:test'
import { defaultGenerateLoadID } from './adapters.js'

test('defaultGenerateLoadID avoids separator collisions', t => {
    const direct = defaultGenerateLoadID('src/foo-bar.js')
    const nested = defaultGenerateLoadID('src/foo/bar.js')
    t.assert.notStrictEqual(direct, nested)
    t.assert.match(direct, /^[A-Za-z0-9_]+$/)
    t.assert.match(nested, /^[A-Za-z0-9_]+$/)
})
