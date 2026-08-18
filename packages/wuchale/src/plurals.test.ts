// $ node --import ../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { orderedPluralForms } from './plurals.js'

test('Plural categories order', (t: TestContext) => {
    t.assert.deepStrictEqual(orderedPluralForms('en'), ['one', 'other'])
    t.assert.deepStrictEqual(orderedPluralForms('es'), ['one', 'many', 'other'])
    t.assert.throws(() => orderedPluralForms('foo bar'))
    t.assert.deepStrictEqual(orderedPluralForms('foobar'), [])
})
