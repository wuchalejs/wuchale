// $$ cd .. && npm run test

import { test } from 'node:test'
import { Runtime } from 'wuchale/runtime'
import { loadLocales, runWithLocale } from 'wuchale/run-server'
import { compileTranslation } from '../dist/compile.js'
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

test('Simple expression and assignment', async function(t) {
    await testContent(t, typescript`
        'Not translation!' // simple expression
        const varName = 'No extraction' // simple assignment
        const noExtract = call('Foo')
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
        const insideObj = {
            method: () => 'Hello',
        }
        const bar: (a: string) => string = (a) => \`Hello \${a\}\`
    `, typescript`
        import _w_load_ from "../tests/test-tmp/loader.js"
        const _w_runtime_ = _w_load_('basic')

        function foo(): string {
            const varName = _w_runtime_.t(0)
            return varName
        }
        const insideObj = {
            method: () => _w_runtime_.t(0),
        }
        const bar: (a: string) => string = (a) => _w_runtime_.t(1, [a])
    `, `
    msgid ""
    msgstr ""

    #: test-tmp/test.js
    #: test-tmp/test.js
    msgid "Hello"
    msgstr "Hello"

    #: test-tmp/test.js
    msgid "Hello {0}"
    msgstr "Hello {0}"
    `, ['Hello', ['Hello ', 0]])
})

const testCatalog = {
    plural: (/** @type {number} */ n) => n == 1 ? 0 : 1,
    data: [
        'Hello', // simple message
        ['Hello ', 0, '!'], // compound message
        ['One item', '# items'], // plurals
        400, // bad
    ]
}

test('Runtime', t => {
    // @ts-expect-error
    const rt = new Runtime(testCatalog)
    t.assert.equal(rt.t(0), 'Hello')
    t.assert.equal(rt.t(1, ['User']), 'Hello User!')
    t.assert.deepEqual(rt.tp(2), ['One item', '# items'])
    t.assert.equal(rt.t(42), '[i18n-404:42]')
    t.assert.equal(rt.t(3), '[i18n-400:3(400)]')
})

// This should be run AFTER the test Runtime completes
test('Runtime server side', async t => {
    // @ts-expect-error
    const getRt = await loadLocales('main', ['main'], _ => testCatalog, ['en'])
    const msg = await runWithLocale('en', () => {
        return getRt('main').t(1, ['server user'])
    })
    t.assert.equal(msg, 'Hello server user!')
})
