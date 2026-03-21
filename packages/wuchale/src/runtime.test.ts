// $ node --import ../testing/resolve.ts %f

import { test } from 'node:test'
// @ts-expect-error
import { testCatalog } from '../testing/utils.ts'
import toRuntime from './runtime.js'

function taggedHandler(msgs: TemplateStringsArray, ...args: any[]) {
    let msg = msgs[0]
    for (const [i, arg] of args.entries()) {
        msg += `${arg}${msgs[i + 1]}`
    }
    return msg
}

test('Runtime', t => {
    const rt = toRuntime(testCatalog, 'en')
    t.assert.equal(rt.l, 'en')
    t.assert.equal(rt(0), 'Hello')
    t.assert.equal(rt(1, ['User']), 'Hello User!')
    t.assert.deepEqual(rt.p(2), ['One item', '# items'])
    t.assert.equal(rt.t(taggedHandler, 1, [3]), taggedHandler`Hello ${3}!`)
    t.assert.equal(rt.t(taggedHandler, 3, [3, 4]), taggedHandler`Hello ${3}${4}`)
    t.assert.equal(rt.t(String.raw, 3, [3, 4]), String.raw`Hello ${3}${4}`)
})
