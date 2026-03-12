// $$ node --import ../../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'

import { toViteError, trimViteQueries } from './vite.js'

test('vite queries trimmed', async (t: TestContext) => {
    t.assert.strictEqual(trimViteQueries('/foo/bar?v=foo'), '/foo/bar')
    t.assert.strictEqual(trimViteQueries('/foo/bar?t=123'), '/foo/bar')
    t.assert.strictEqual(trimViteQueries('/foo/bar?t=123&css=true'), '/foo/bar?t=123&css=true')
    t.assert.strictEqual(trimViteQueries('/foo/bar?css=true'), '/foo/bar?css=true')
})

test('error correctly formatted', async (t: TestContext) => {
    const e = new Error('boom')
    ;(e as any).frame = '1: <svelte:window />\n   ^'
    t.assert.throws(
        () => toViteError(e, 'bad', 'test.js'),
        (err: any) => {
            t.assert.ok(err instanceof Error)
            t.assert.ok(err.message.startsWith('bad: transform failed for test.js\nboom'))
            t.assert.ok(err.message.includes('<svelte:window />'))
            return true
        },
    )
})
