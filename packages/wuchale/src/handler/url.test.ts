// $ node --import ../../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { URLHandler } from './url.js'

const handler = new URLHandler(['en', 'es'], 'en', {
    patterns: ['/bar/*'],
})

test('URL correct init', async (t: TestContext) => {
    await handler.initPatterns('foo', new Map(), new Map())
    t.assert.deepStrictEqual(handler.compiledPatterns[0]?.get('es'), ['/bar', 2])
})

test('URL pattern match', (t: TestContext) => {
    t.assert.deepStrictEqual(handler.match('/bar/foo'), [0, ['/foo']])
    t.assert.deepStrictEqual(handler.matchToCompile('/bar/foo-{0}', 'en'), '/bar/foo-{0}')
})
