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
    // anonymous function passed to a call inside a named one, e.g. an inline event handler in a component
    t.assert.deepStrictEqual(
        getFuncNameNested([
            { type: 'function', name: 'Foo' },
            { type: 'call', kind: 'function', name: 'alert' },
            { type: 'funcexpr', kind: 'arrow' },
        ]),
        ['', true],
    )
})
