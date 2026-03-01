// $ node --import ../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { type CompiledElement, compileTranslation, isEquivalent } from './compile.js'

test('Compile messages', t => {
    const testCompile = (msg: string, expect: CompiledElement) =>
        t.assert.deepEqual(compileTranslation(msg, ''), expect)
    testCompile('Foo', 'Foo')
    testCompile('Foo {0}', ['Foo ', 0])
    testCompile('Foo <0>bar</0>', ['Foo ', [0, 'bar']])
    testCompile('Foo <0>bar {0}</0>', ['Foo ', [0, 'bar ', 0]])
    testCompile('Foo <0>bar {0}<0/></0>', ['Foo ', [0, 'bar ', 0, [0]]])
    testCompile('foo <0>bold <form>ignored <0/> {0} <1>nest {0}</1></0> <1/> bar', [
        'foo ',
        [0, 'bold <form>ignored ', [0], ' ', 0, ' ', [1, 'nest ', 0]],
        ' ',
        [1],
        ' bar',
    ])
})

test('Compare compiled equivalent', (t: TestContext) => {
    t.assert.ok(isEquivalent('orig', 'transl'))
    t.assert.ok(isEquivalent(['orig ', 0], ['transl ', 0]))
    t.assert.ok(!isEquivalent(['orig ', 0], [0])) // less non-strings
    t.assert.ok(!isEquivalent(['orig ', 0], ['added ', 0, 99])) // more non-strings
    t.assert.ok(
        isEquivalent(
            ['foo ', [0, 'some orig ', [0], ' ', 0, ' ', [1, 'nest orig ', 0]], ' ', [1], ' orig'],
            [[1], [0, 'translated ', [0], [1, 'nest other ord ', 0], ' ', 0, ' '], ' transl'],
        ),
    )
})
