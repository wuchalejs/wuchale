// $ node --import ../../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { URLHandler } from './url.js'

const handler = new URLHandler(['en'], 'en', {
    patterns: ['/bar/*'],
})
handler.initPatterns('foo', new Map())

test('URL pattern match', (t: TestContext) => {
    t.assert.deepStrictEqual(handler.match('/bar/foo'), [0, ['/foo']])
    t.assert.deepStrictEqual(handler.matchToCompile('/bar/foo-{0}', 'en'), '/bar/foo-{0}')
})
