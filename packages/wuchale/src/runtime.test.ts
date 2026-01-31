// $ node --import ../testing/resolve.ts %f

import { test } from 'node:test'
// @ts-expect-error
import { testCatalog } from '../testing/utils.ts'
import toRuntime from './runtime.js'

function taggedHandler(msgs: TemplateStringsArray, ...args: any[]) {
    return msgs.join('_') + args.join('_')
}

test('Runtime', t => {
    const rt = toRuntime(testCatalog, 'en')
    t.assert.equal(rt.l, 'en')
    t.assert.equal(rt(0), 'Hello')
    t.assert.equal(rt(1, ['User']), 'Hello User!')
    t.assert.deepEqual(rt.p(2), ['One item', '# items'])
    t.assert.equal(rt.t(taggedHandler, 1, [3]), taggedHandler`Hello ${3}!`)
    t.assert.equal(rt.t(taggedHandler, 3, [3]), taggedHandler`Hello ${3}`)
})
