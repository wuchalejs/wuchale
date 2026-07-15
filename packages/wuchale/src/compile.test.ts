// $ node --import ../testing/resolve.ts %f

import { test } from 'node:test'
import { type CompiledElement, compileTranslation } from './compile.js'

test('Compile items', t => {
    const testCompile = (txt: string, expect: CompiledElement) =>
        t.assert.deepEqual(compileTranslation(txt, 'Fallback'), expect)
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
    testCompile('Invalid <0>', 'Fallback')
})
