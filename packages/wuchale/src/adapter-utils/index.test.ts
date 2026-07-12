// $ node --import ../../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { getFuncNameNested } from './index.js'

test('RT details', (t: TestContext) => {
    t.assert.deepStrictEqual(
        getFuncNameNested([
            { type: 'function', name: 'foo' },
            { type: 'assignment', left: false, targets: ['bar'] },
            { type: 'funcexpr', kind: 'arrow' },
        ]),
        ['bar', true],
    )
    t.assert.deepStrictEqual(getFuncNameNested([{ type: 'function', name: 'foo' }]), ['foo', false])
})
