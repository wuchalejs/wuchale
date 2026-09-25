// $ node --import ../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { isEquivalent } from './validate.js'

test('Compare singular equivalents', (t: TestContext) => {
    t.assert.ok(isEquivalent('orig', 'transl', null))
    t.assert.ok(isEquivalent(['orig ', 0], ['transl ', 0], null))
    t.assert.ok(!isEquivalent(['orig ', 0], [0], null)) // less non-strings
    t.assert.ok(!isEquivalent(['orig ', 0], ['added ', 0, 99], null)) // more non-strings
    t.assert.ok(
        isEquivalent(
            ['foo ', [0, 'some orig ', [0], ' ', 0, ' ', [1, 'nest orig ', 0]], ' ', [1], ' orig'],
            [[1], [0, 'translated ', [0], [1, 'nest other ord ', 0], ' ', 0, ' '], ' transl'],
            null,
        ),
    )
})

test('Compare plural equivalents', (t: TestContext) => {
    t.assert.ok(isEquivalent([['foo ', 0], 'bar'], [['bee', 0], 'boo'], 2))
    t.assert.ok(isEquivalent([['foo ', 0], 'bar'], [['bee', 0], ['boo', 0], 'bar'], 3))
    t.assert.ok(
        !isEquivalent(
            [['foo ', 0], 'bar'],
            [
                ['bee', 0],
                ['boo', 1],
            ],
            2,
        ),
    )
    t.assert.ok(!isEquivalent([['foo ', 0], 'bar'], ['bee', 'boo'], 2))
})
