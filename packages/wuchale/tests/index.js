// $$ cd .. && npm run test

import { test } from 'node:test'
import wrapRT, { Runtime } from 'wuchale/runtime'
import { loadLocales, runWithLocale } from 'wuchale/load-utils/server'
import { registerLoaders, loadLocaleSync, defaultCollection } from 'wuchale/load-utils'
import { loadCatalogs } from 'wuchale/load-utils/pure'
import { compileTranslation } from '../dist/compile.js'
import { testContent, basic, typescript, adapterOpts } from './check.js'
import { statfs } from 'fs/promises'

test('Compile nested', function(t) {
    t.assert.deepEqual(compileTranslation('Foo <0>bar</0>', 'foo'), ['Foo ', [0, 'bar']])
    t.assert.deepEqual(compileTranslation('Foo <0>bar {0}</0>', 'foo'), ['Foo ', [0, 'bar ', 0]])
    t.assert.deepEqual(compileTranslation('Foo <0>bar {0}<0/></0>', 'foo'), ['Foo ', [0, 'bar ', 0, [0]]])
    t.assert.deepEqual(
        compileTranslation('foo <0>bold <form>ignored <0/> {0} <1>nest {0}</1></0> <1/> bar', 'foo'),
        ['foo ', [ 0, 'bold <form>ignored ', [ 0 ], ' ', 0, ' ', [ 1, 'nest ', 0 ] ], ' ', [ 1 ], ' bar'],
    )
})

test('Default loader file paths', async function(t){
    for (const loader of ['server', 'vite', 'bundle']) {
        const path = basic.defaultLoaderPath(loader)
        const paths = typeof path === 'string' ? [path] : Object.values(path)
        for (const path of paths) {
            await statfs(path) // no error
        }
    }
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
        'use strict'
        function foo(): string {
            const varName = 'Hello'
            return varName
        }
        const insideObj = {
            method: () => 'Not inside func def',
        }
        const bar: (a: string) => string = (a) => {
            const foo = {
                'Extracted': 42,
            }
            return \`Hello \${a\}\`
        }
    `, typescript`
        'use strict'
        import _w_to_rt_ from 'wuchale/runtime'
        import _w_load_ from "../tests/test-tmp/loader.js"

        function foo(): string {
            const _w_runtime_ = _w_to_rt_(_w_load_('main'))
            const varName = _w_runtime_.t(0)
            return varName
        }
        const insideObj = {
            method: () => 'Not inside func def',
        }
        const bar: (a: string) => string = (a) => {
            const _w_runtime_ = _w_to_rt_(_w_load_('main'))
            const foo = {
                [_w_runtime_.t(1)]: 42,
            }
            return _w_runtime_.t(2, [a])
        }
    `, `
    msgid ""
    msgstr ""

    #: test-tmp/test.js
    msgid "Hello"
    msgstr "Hello"

    #: test-tmp/test.js
    msgid "Extracted"
    msgstr "Extracted"

    #: test-tmp/test.js
    msgid "Hello {0}"
    msgstr "Hello {0}"
    `, ['Hello', 'Extracted', ['Hello ', 0]])
})

test('HMR', async function(t) {
    await testContent(t, typescript`
        function foo(): string {
            const varName = 'Hello'
            return varName
        }
    `, typescript`
        const _w_hmrUpdate_ = {"version":1,"data":{"en":[[0,"Hello"]]}}

        import _w_to_rt_ from 'wuchale/runtime'
        import _w_load_hmr_ from "../tests/test-tmp/loader.js"

        function _w_load_(loadID) {
            const _w_catalog_ = _w_load_hmr_(loadID)
            _w_catalog_?.update?.(_w_hmrUpdate_)
            return _w_catalog_
        }

        function foo(): string {
            const _w_runtime_ = _w_to_rt_(_w_load_('main'))
            const varName = _w_runtime_.t(0)
            return varName
        }
    `, `
    msgid ""
    msgstr ""

    #: test-tmp/test.js
    msgid "Hello"
    msgstr "Hello"

    `, ['Hello'], basic, 1)
})

const testCatalog = {
    p: (/** @type {number} */ n) => n == 1 ? 0 : 1,
    c: [
        'Hello', // simple message
        ['Hello ', 0, '!'], // compound message
        ['One item', '# items'], // plurals
    ]
}
const loaderFunc = () => testCatalog

test('Loading and runtime', async t => {
    const collection = {}
    // @ts-expect-error
    const getCatalog = registerLoaders('main', loaderFunc, ['foo'], defaultCollection(collection))
    loadLocaleSync('en')
    t.assert.notEqual(collection['foo'], null) // setCatalogs was called
    const rt = wrapRT(getCatalog('foo'))
    t.assert.equal(rt.t(0), 'Hello')
    t.assert.equal(rt.t(1, ['User']), 'Hello User!')
    t.assert.deepEqual(rt.tp(2), ['One item', '# items'])
    const cPure = await loadCatalogs('en', ['foo'], loaderFunc)
    t.assert.equal(wrapRT(cPure['foo']).t(0), 'Hello')
})

test('Runtime', t => {
    const rt = new Runtime(testCatalog)
    t.assert.equal(rt.t(0), 'Hello')
    t.assert.equal(rt.t(1, ['User']), 'Hello User!')
    t.assert.deepEqual(rt.tp(2), ['One item', '# items'])
})

// This should be run AFTER the test Runtime completes
test('Runtime server side', async t => {
    const getCatalog = await loadLocales('main', ['main'], _ => testCatalog, ['en'])
    const msg = await runWithLocale('en', () => {
        return wrapRT(getCatalog('main')).t(1, ['server user'])
    })
    t.assert.equal(msg, 'Hello server user!')
})
