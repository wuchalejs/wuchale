// $$ cd .. && npm run test

import { test } from 'node:test'
import { compileTranslation } from '../dist/src/compile.js'
import { testContent, testDir, javascript, typescript } from './check.js'
import { setCatalog, _wre_, _wrc_, runWithCatalog } from '../dist/src/runtime.js'

test('Compile nested', function(t) {
    t.assert.deepEqual(compileTranslation('Foo <0>bar</0>', 'foo'), ['Foo ', [0, 'bar']])
    t.assert.deepEqual(compileTranslation('Foo <0>bar {0}</0>', 'foo'), ['Foo ', [0, 'bar ', 0]])
    t.assert.deepEqual(compileTranslation('Foo <0>bar {0}<0/></0>', 'foo'), ['Foo ', [0, 'bar ', 0, [0]]])
    t.assert.deepEqual(
        compileTranslation('foo <0>bold <form>ignored <0/> {0} <1>nest {0}</1></0> <1/> bar', 'foo'),
        ['foo ', [ 0, 'bold <form>ignored ', [ 0 ], ' ', 0, ' ', [ 1, 'nest ', 0 ] ], ' ', [ 1 ], ' bar'],
    )
})

test('Simple expression and assignment', async function(t) {
    await testContent(t, typescript`
        'Not translation!' // simple expression
        const varName = 'No extraction' // simple assignment
    `, undefined, `
    msgid ""
    msgstr ""
    `, [])
})

test('Inside function definitions', async function(t) {
    await testContent(t, typescript`
        function foo(): string {
            const varName = 'Hello'
            return varName
        }
        const bar: (a: string) => string = (a) => \`Hello \${a\}\`
    `, typescript`
        import { _wre_ } from "wuchale/runtime"
        const wuchaleRuntime = _wre_("basic")

        function foo(): string {
            const varName = wuchaleRuntime.t(0)
            return varName
        }
        const bar: (a: string) => string = (a) => wuchaleRuntime.t(1, [a])
    `, `
    msgid ""
    msgstr ""

    #: src/test.svelte
    msgid "Hello"
    msgstr "Hello"

    #: src/test.svelte
    msgid "Hello {0}"
    msgstr "Hello {0}"
    `, ['Hello', ['Hello ', 0]])
})

const testCatalog = {
    key: 'test',
    pluralsRule: n => n == 1 ? 0 : 1,
    default: [
        'Hello', // simple message
        ['Hello ', 0, '!'], // compound message
        ['One item', '# items'], // plurals
        400, // bad
    ]
}

test('Runtime', t => {
    setCatalog(testCatalog)
    t.assert.equal(_wrc_('test').t(0), 'Hello')
    t.assert.equal(_wrc_('test').t(1, ['User']), 'Hello User!')
    t.assert.deepEqual(_wrc_('test').tp(2), ['One item', '# items'])
    t.assert.equal(_wrc_('test').t(42), '[i18n-404:42]')
    t.assert.equal(_wrc_('test').t(3), '[i18n-400:3(400)]')
})

test('Runtime server side', t => {
    const msg = runWithCatalog(testCatalog, () => {
        return _wre_().t(1, ['server user'])
    })
    t.assert.equal(msg, 'Hello server user!')
})
