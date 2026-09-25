// $ node --import ../../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { getPathEnd, URLHandler } from './url.js'

const handler = new URLHandler(['en', 'es'], 'en', {
    patterns: ['/bar/*'],
})

test('URL correct init', async (t: TestContext) => {
    await handler.initPatterns('foo', new Map(), new Map())
    t.assert.deepStrictEqual(handler.compiledPatterns.get('/bar/*')?.get('es'), ['/bar', 2])
})

test('URL pattern match', (t: TestContext) => {
    t.assert.deepStrictEqual(handler.match('/bar/foo'), '/bar/*')
    t.assert.deepStrictEqual(handler.match('/bar/foo?foo=bar#bee/boo?'), '/bar/*')
    t.assert.deepStrictEqual(handler.matchToCompile('/bar/foo-{0}', '/bar/*', 'en'), '/bar/foo-{0}')
})

test('URL get path end', (t: TestContext) => {
    t.assert.strictEqual(getPathEnd('foo'), 3)
    t.assert.strictEqual(getPathEnd('foo?foo=bar'), 3)
    t.assert.strictEqual(getPathEnd('foo#foo/bar'), 3)
    t.assert.strictEqual(getPathEnd('foo#foo?bar=bee'), 3)
    t.assert.strictEqual(getPathEnd('foo?foo=bar#bee?'), 3)
})
