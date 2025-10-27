// $$ cd .. && npm run test

import { test } from 'node:test'
import toRuntime from 'wuchale/runtime'
import { loadLocales, runWithLocale } from 'wuchale/load-utils/server'
import { getDefaultLoaderPath } from 'wuchale/adapter-vanilla'
import { registerLoaders, loadLocaleSync, defaultCollection } from 'wuchale/load-utils'
import { loadCatalogs } from 'wuchale/load-utils/pure'
import { compileTranslation } from '../dist/compile.js'
import { testContent, basic, typescript } from './check.js'
import { statfs } from 'fs/promises'
import { URLMatcher } from 'wuchale/url'

test('Compile nested', function(t) {
    t.assert.deepEqual(compileTranslation('Foo <0>bar</0>', 'foo'), ['Foo ', [0, 'bar']])
    t.assert.deepEqual(compileTranslation('Foo <0>bar {0}</0>', 'foo'), ['Foo ', [0, 'bar ', 0]])
    t.assert.deepEqual(compileTranslation('Foo <0>bar {0}<0/></0>', 'foo'), ['Foo ', [0, 'bar ', 0, [0]]])
    t.assert.deepEqual(
        compileTranslation('foo <0>bold <form>ignored <0/> {0} <1>nest {0}</1></0> <1/> bar', 'foo'),
        ['foo ', [ 0, 'bold <form>ignored ', [ 0 ], ' ', 0, ' ', [ 1, 'nest ', 0 ] ], ' ', [ 1 ], ' bar'],
    )
})

test('Default loader file paths', async function(){
    for (const loader of ['server', 'vite', 'bundle']) {
        for (const bundle of [false, true]) {
            const path = getDefaultLoaderPath(loader, bundle)
            const paths = typeof path === 'string' ? [path] : Object.values(path)
            for (const path of paths) {
                await statfs(path) // no error
            }
        }
    }
})

test('Simple expression and assignment', async function(t) {
    await testContent(t, typescript`
        'No extraction!' // simple expression
        const varName = 'No extraction' // simple assignment
        const noExtract = call('Foo')
    `, undefined, `
    msgid ""
    msgstr ""
    `, [])
})

test('Ignore file', async function(t) {
    await testContent(t, typescript`
        // @wc-ignore-file
        function foo() {
            const varName = 'No extraction'
            const noExtract = call('Foo')
        }
        function bar() {
            return 'Ignored'
        }
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
            method: () => 'Inside func property',
        }
        const bar: (a: string) => string = (a) => {
            const foo = {
                'Extracted': 42,
                tagged: tag\`Hello\`,
                taggedWithExpr: tag\`Hello \${a}\`
            }
            return \`Hello \${a\}\`
        }
    `, typescript`
        'use strict'
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/main.loader.js"

        function foo(): string {
            const _w_runtime_ = _w_load_('main')
            const varName = _w_runtime_.t(0)
            return varName
        }
        const insideObj = {
            method: () => {
                const _w_runtime_ = _w_load_('main')
                return _w_runtime_.t(1)
            },
        }
        const bar: (a: string) => string = (a) => {
            const _w_runtime_ = _w_load_('main')
            const foo = {
                [_w_runtime_.t(2)]: 42,
                tagged: _w_runtime_.tt(tag, 0),
                taggedWithExpr: _w_runtime_.tt(tag, 3, [a])
            }
            return _w_runtime_.t(3, [a])
        }
    `, `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.js
    #: tests/test-dir/test.js
    msgid "Hello"
    msgstr "Hello"

    #: tests/test-dir/test.js
    msgid "Inside func property"
    msgstr "Inside func property"

    #: tests/test-dir/test.js
    msgid "Extracted"
    msgstr "Extracted"

    #. placeholder {0}: a
    #. placeholder {0}: a
    #: tests/test-dir/test.js
    #: tests/test-dir/test.js
    msgid "Hello {0}"
    msgstr "Hello {0}"
    `, ['Hello', 'Inside func property', 'Extracted', ['Hello ', 0]])
})

test('Inside class declarations', async function(t) {
    await testContent(t, typescript`
        class foo {
            constructor() {
                return 'Hello'
            }

            foo() {
                return 'Hello'
            }
        }
    `, typescript`
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/main.loader.js"

        class foo {
            constructor() {
                const _w_runtime_ = _w_load_('main')
                return _w_runtime_.t(0)
            }

            foo() {
                const _w_runtime_ = _w_load_('main')
                return _w_runtime_.t(0)
            }
        }
    `, `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.js
    #: tests/test-dir/test.js
    msgid "Hello"
    msgstr "Hello"

    `, ['Hello'])
})

test('Plural', async function(t) {
    await testContent(t,
        typescript`
            const f = () => plural(items, ['One item', '# items'])
        `,
        typescript`
            import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/main.loader.js"
            const f = () => {
                const _w_runtime_ = _w_load_('main')
                return plural(items, _w_runtime_.tp(0), _w_runtime_._.p)
            }
    `, `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.js
    msgid "One item"
    msgid_plural "# items"
    msgstr[0] "One item"
    msgstr[1] "# items"
    `, [ [ 'One item', '# items' ] ])
})

test('HMR', async function(t) {
    await testContent(t, typescript`
        function foo(): string {
            const varName = 'Hello'
            return varName
        }
    `, typescript`
        import {getRuntime as _w_load_hmr_, getRuntimeRx as _w_load_rx_hmr_} from "../test-tmp/main.loader.js"

        const _w_hmrUpdate_ = {"version":1,"data":{"en":[[0,"Hello"]]}}

        function _w_load_(loadID) {
            const _w_rt_ = _w_load_hmr_(loadID)
            _w_rt_?._?.update?.(_w_hmrUpdate_)
            return _w_rt_
        }

        function _w_load_rx_(loadID) {
            const _w_rt_ = _w_load_rx_hmr_(loadID)
            _w_rt_?._?.update?.(_w_hmrUpdate_)
            return _w_rt_
        }

        function foo(): string {
            const _w_runtime_ = _w_load_('main')
            const varName = _w_runtime_.t(0)
            return varName
        }
    `, `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.js
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
    /** @type {object} */
    const collection = {}
    const getRT = registerLoaders('main', loaderFunc, ['foo'], defaultCollection(collection))
    loadLocaleSync('en')
    t.assert.notEqual(collection['foo'], null) // setCatalogs was called
    const rt = getRT('foo')
    t.assert.equal(rt.l, 'en')
    t.assert.equal(rt.t(0), 'Hello')
    t.assert.equal(rt.t(1, ['User']), 'Hello User!')
    t.assert.deepEqual(rt.tp(2), ['One item', '# items'])
    const cPure = await loadCatalogs('en', ['foo'], loaderFunc)
    t.assert.equal(toRuntime(cPure['foo']).t(0), 'Hello')
})

/**
 * @param {TemplateStringsArray} msgs
 * @param {any[]} args
 */
function taggedHandler(msgs, ...args) {
    return msgs.join('_') + args.join('_')
}

test('Runtime', t => {
    const rt = toRuntime(testCatalog)
    t.assert.equal(rt.t(0), 'Hello')
    t.assert.equal(rt.t(1, ['User']), 'Hello User!')
    t.assert.deepEqual(rt.tp(2), ['One item', '# items'])
    t.assert.equal(taggedHandler`foo ${1} bar ${2}`, 'foo _ bar _1_2')
    t.assert.equal(rt.tt(taggedHandler, 1, [3]), 'Hello _!3')
})

// This should be run AFTER the test Runtime completes
test('Runtime server side', async t => {
    const getRT = await loadLocales('main', ['main'], _ => testCatalog, ['en'])
    const msg = await runWithLocale('en', () => {
        return getRT('main').t(1, ['server user'])
    })
    t.assert.equal(msg, 'Hello server user!')
})

test('URL matcher', t => {
    const matcher = URLMatcher([
        [
            "/path",
            [["en","/en/path"],["es","/es/ruta"]]
        ],
        [
            "/",
            [["en","/en"],["es","/es"]]
        ],
        [
            "/*rest",
            [["en","/en/*rest"],["es","/es/*rest"]]
        ],
    ], ['en', 'es'])
    t.assert.deepEqual(matcher(new URL('http://foo.js/')), {path: null, locale: null})
    t.assert.deepEqual(matcher(new URL('http://foo.js/en/foo')), {path: '/foo', locale: 'en'})
    t.assert.deepEqual(matcher(new URL('http://foo.js/en')), {path: '/', locale: 'en'})
    t.assert.deepEqual(matcher(new URL('http://foo.js/en/')), {path: '/', locale: 'en'})
})
