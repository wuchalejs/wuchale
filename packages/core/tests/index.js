// $$ cd .. && npm run test

import { test } from 'node:test'
import { compileTranslation } from '../dist/src/plugin/compile.js'
import { testContent, testDir, javascript, typescript } from './check.js'

test('Compile nested', function(t) {
    t.assert.deepEqual(compileTranslation('Foo <0>bar</0>', 'foo'), ['Foo ', [0, 'bar']])
    t.assert.deepEqual(compileTranslation('Foo <0>bar {0}</0>', 'foo'), ['Foo ', [0, 'bar ', 0]])
    t.assert.deepEqual(compileTranslation('Foo <0>bar {0}<0/></0>', 'foo'), ['Foo ', [0, 'bar ', 0, [0]]])
    t.assert.deepEqual(
        compileTranslation('foo <0>bold <form>ignored <0/> {0} <1>nest {0}</1></0> <1/> bar', 'foo'),
        ['foo ', [ 0, 'bold <form>ignored ', [ 0 ], ' ', 0, ' ', [ 1, 'nest ', 0 ] ], ' ', [ 1 ], ' bar'],
    )
})

test('Simple string expression', async function(t) {
    await testContent(t, '"Hello"', '', `
    msgid ""
    msgstr ""
    `, [])
})

test('Variable assign', async function(t) {
    await testContent(t, typescript`
        const varName = 'Hello'
    `, typescript`
        import { _wre_ } from "wuchale/runtime"
        const wuchaleRuntime = _wre_("es")

        const varName = wuchaleRuntime.t(0)
    `, `
    msgid ""
    msgstr ""

    #: src/test.svelte
    msgid "Hello"
    msgstr "Hello"
    `, ['Hello'])
})

