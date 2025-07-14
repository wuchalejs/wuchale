// $$ cd .. && npm run test

import { test } from 'node:test'
import { compileTranslation } from '../dist/src/plugin/compile.js'
import { testContent, testDir, javascript, typescript } from './check.js'
import { setCatalog, _wre_ } from '../dist/src/runtime.js'
import { runWithCatalog, _wre_ as wre_server } from '../dist/src/runtime-server.js'

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

const testCatalog = {pluralsRule: n => n, default: [
    'Hello', // simple message
    ['Hello ', 0, '!'], // compound message
    ['One item', '# items'], // plurals
]}

test('Runtime', t => {
    setCatalog(testCatalog, 'test')
    t.assert.equal(_wre_('test').t(0), 'Hello')
    t.assert.equal(_wre_('test').t(1, ['User']), 'Hello User!')
    t.assert.deepEqual(_wre_('test').tp(2), ['One item', '# items'])
    t.assert.equal(_wre_('test').t(42), '[i18n-404:42(undefined)]')
})

test('Runtime server side', t => {
    const msg = runWithCatalog(testCatalog, () => {
        return wre_server().t(1, ['server user'])
    })
    t.assert.equal(msg, 'Hello server user!')
})
