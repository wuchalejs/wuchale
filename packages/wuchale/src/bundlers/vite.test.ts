// $$ node --import ../../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'

import { toViteError, trimViteQueries } from './vite.js'

test('vite queries trimmed', async (t: TestContext) => {
    const trim = new Set(['v', 't'])
    t.assert.strictEqual(trimViteQueries('/foo/bar', trim), '/foo/bar')
    t.assert.strictEqual(trimViteQueries('/foo/bar?v=foo', trim), '/foo/bar')
    t.assert.strictEqual(trimViteQueries('/foo/bar?t=123', trim), '/foo/bar')
    t.assert.strictEqual(trimViteQueries('/foo/bar?t=123&html&css=true', trim), '/foo/bar?t=123&html&css=true')
    t.assert.strictEqual(trimViteQueries('/foo/bar?css=true', trim), '/foo/bar?css=true')
    t.assert.strictEqual(trimViteQueries('/foo/bar?v&t=true', trim), '/foo/bar')
})

test('error correctly formatted', async (t: TestContext) => {
    const e = new Error('boom')
    ;(e as any).frame = '1: <svelte:window />\n   ^'
    const err = toViteError(e, 'bad', 'test.js')
    t.assert.ok(err instanceof Error)
    t.assert.ok(err.message.startsWith('bad: transform failed for test.js\nboom'))
    t.assert.ok(err.message.includes('<svelte:window />'))
})
