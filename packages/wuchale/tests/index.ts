// $$ cd .. && npm run test

import { test } from 'node:test'
import { statfs } from 'fs/promises'
import type { CompiledElement } from 'wuchale'
import { adapter, getDefaultLoaderPath } from 'wuchale/adapter-vanilla'
import { defaultCollection, loadLocaleSync, registerLoaders } from 'wuchale/load-utils'
import { loadCatalogs } from 'wuchale/load-utils/pure'
import { loadLocales, runWithLocale } from 'wuchale/load-utils/server'
import toRuntime from 'wuchale/runtime'
import { URLMatcher } from 'wuchale/url'
import { compileTranslation } from '../dist/compile.js'
// @ts-expect-error
import { adapterOpts, basic, testContent, ts } from './check.ts'

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

test('Default loader file paths', async () => {
    for (const loader of ['server', 'vite', 'bundle']) {
        for (const bundle of [false, true]) {
            const path = getDefaultLoaderPath(loader, bundle)
            const paths = typeof path === 'string' ? [path] : Object.values(path ?? {})
            for (const path of paths) {
                await statfs(path) // no error
            }
        }
    }
})

test('Simple expression and assignment', async t => {
    await testContent(
        t,
        ts`
        'No extraction!' // simple expression
        const varName = 'No extraction' // simple assignment
        const noExtract = call('Foo')
    `,
        undefined,
        `
    msgid ""
    msgstr ""
    `,
        [],
    )
})

test('Ignore file', async t => {
    await testContent(
        t,
        ts`
        // @wc-ignore-file
        function foo() {
            const varName = 'No extraction'
            const noExtract = call('Foo')
        }
        function bar() {
            return 'Ignored'
        }
    `,
        undefined,
        `
    msgid ""
    msgstr ""
    `,
        [],
    )
})

test('Inside function definitions', async t => {
    await testContent(
        t,
        ts`
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
    `,
        ts`
        'use strict'
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/main.loader.js"

        function foo(): string {
            const _w_runtime_ = _w_load_('main')
            const varName = _w_runtime_(0)
            return varName
        }
        const insideObj = {
            method: () => {
                const _w_runtime_ = _w_load_('main')
                return _w_runtime_(1)
            },
        }
        const bar: (a: string) => string = (a) => {
            const _w_runtime_ = _w_load_('main')
            const foo = {
                [_w_runtime_(2)]: 42,
                tagged: _w_runtime_.t(tag, 0),
                taggedWithExpr: _w_runtime_.t(tag, 3, [a])
            }
            return _w_runtime_(3, [a])
        }
    `,
        `
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

    #. 0: a
    #. 0: a
    #: tests/test-dir/test.js
    #: tests/test-dir/test.js
    msgid "Hello {0}"
    msgstr "Hello {0}"
    `,
        ['Hello', 'Inside func property', 'Extracted', ['Hello ', 0]],
    )
})

test('Inside class declarations', async t => {
    await testContent(
        t,
        ts`
        class foo {
            constructor() {
                return 'Hello'
            }

            foo() {
                return 'Hello'
            }
        }
    `,
        ts`
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/main.loader.js"

        class foo {
            constructor() {
                const _w_runtime_ = _w_load_('main')
                return _w_runtime_(0)
            }

            foo() {
                const _w_runtime_ = _w_load_('main')
                return _w_runtime_(0)
            }
        }
    `,
        `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.js
    #: tests/test-dir/test.js
    msgid "Hello"
    msgstr "Hello"

    `,
        ['Hello'],
    )
})

test('Runtime init place', async t => {
    await testContent(
        t,
        ts`
        function foo() {
            'foo'
            some.call()
            if (3 == 3) {
                return 42
            }
            return 'Hello'
        }
    `,
        ts`
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/main.loader.js"

        function foo() {
            'foo'
            some.call()
            const _w_runtime_ = _w_load_('main')
            if (3 == 3) {
                return 42
            }
            return _w_runtime_(0)
        }
    `,
        `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.js
    msgid "Hello"
    msgstr "Hello"

    `,
        ['Hello'],
    )
})

test('Plural and patterns', async t => {
    await testContent(
        t,
        ts`
            const f = () => plural(items, ['One item', '# items'])
            function foo() {
                return [
                    format0(44),
                    format0(44, foo),
                    format0(44, 'en'),
                    format1(44),
                    format2('en'),
                    format2(),
                    format2(foo),
                ]
            }
        `,
        ts`
            import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/main.loader.js"
            const f = () => {
                const _w_runtime_ = _w_load_('main')
                return plural(items, _w_runtime_.p(0), _w_runtime_._.p)
            }
            function foo() {
                return [
                    format0(44, _w_runtime_.l),
                    format0(44, foo),
                    format0(44, _w_runtime_.l),
                    format1(44, undefined, _w_runtime_.l),
                    format2(_w_runtime_.l),
                    format2(_w_runtime_.l),
                    format2(foo),
                ]
            }
    `,
        `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.js
    msgid "One item"
    msgid_plural "# items"
    msgstr[0] "One item"
    msgstr[1] "# items"
    `,
        [['One item', '# items']],
        adapter({
            ...adapterOpts,
            patterns: [
                { name: 'plural', args: ['other', 'message', 'pluralFunc'] },
                { name: 'format0', args: ['other', 'locale'] },
                { name: 'format1', args: ['other', 'other', 'locale', 'other'] },
                { name: 'format2', args: ['locale'] },
            ],
        }),
    )
})

test('HMR', async t => {
    await testContent(
        t,
        ts`
        function foo(): string {
            const varName = 'Hello'
            return varName
        }
    `,
        ts`
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
            const varName = _w_runtime_(0)
            return varName
        }
    `,
        `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.js
    msgid "Hello"
    msgstr "Hello"

    `,
        ['Hello'],
        basic,
        1,
    )
})

const testCatalog = {
    p: (n: number) => (n == 1 ? 0 : 1),
    c: [
        'Hello', // simple message
        ['Hello ', 0, '!'], // mixed message
        ['One item', '# items'], // plurals
        ['Hello ', 0], // mixed message ending with arg
    ],
}
const loaderFunc = () => testCatalog

test('Loading and runtime', async t => {
    const collection = {}
    const getRT = registerLoaders('main', loaderFunc, ['foo'], defaultCollection(collection))
    loadLocaleSync('en')
    t.assert.notEqual(collection['foo'], null) // setCatalogs was called
    const rt = getRT('foo')
    t.assert.equal(rt.l, 'en')
    t.assert.equal(rt(0), 'Hello')
    t.assert.equal(rt(1, ['User']), 'Hello User!')
    t.assert.deepEqual(rt.p(2), ['One item', '# items'])
    const cPure = await loadCatalogs('en', ['foo'], loaderFunc)
    t.assert.equal(toRuntime(cPure['foo'])(0), 'Hello')
})

function taggedHandler(msgs: TemplateStringsArray, ...args: any[]) {
    return msgs.join('_') + args.join('_')
}

test('Runtime', t => {
    const rt = toRuntime(testCatalog)
    t.assert.equal(rt(0), 'Hello')
    t.assert.equal(rt(1, ['User']), 'Hello User!')
    t.assert.deepEqual(rt.p(2), ['One item', '# items'])
    t.assert.equal(rt.t(taggedHandler, 1, [3]), taggedHandler`Hello ${3}!`)
    t.assert.equal(rt.t(taggedHandler, 3, [3]), taggedHandler`Hello ${3}`)
})

// This should be run AFTER the test Runtime completes
test('Runtime server side', async t => {
    const getRT = await loadLocales('main', ['main'], _ => testCatalog, ['en'])
    const msg = await runWithLocale('en', () => {
        return getRT('main')(1, ['server user'])
    })
    t.assert.equal(msg, 'Hello server user!')
})

test('URL matcher', t => {
    const matcher = URLMatcher(
        [
            ['/path', ['/en/path', '/es/ruta']],
            ['/*rest', ['/en/*rest', '/es/*rest']],
            ['/', ['/en', '/es']],
        ],
        ['en', 'es'],
    )
    t.assert.deepEqual(matcher(new URL('http://foo.js/')), {
        path: '/',
        locale: null,
        altPatterns: { en: '/en', es: '/es' },
        params: {},
    })
    t.assert.deepEqual(matcher(new URL('http://foo.js/en/foo')), {
        path: '/foo',
        locale: 'en',
        altPatterns: { en: '/en/*rest', es: '/es/*rest' },
        params: { rest: 'foo' },
    })
    t.assert.deepEqual(matcher(new URL('http://foo.js/en')), {
        path: '/',
        locale: 'en',
        altPatterns: { en: '/en', es: '/es' },
        params: {},
    })
    t.assert.deepEqual(matcher(new URL('http://foo.js/es/')), {
        path: '/',
        locale: 'es',
        altPatterns: { en: '/en', es: '/es' },
        params: {},
    })
    t.assert.deepEqual(matcher(new URL('http://foo.js/es/ruta')), {
        path: '/path',
        locale: 'es',
        altPatterns: { en: '/en/path', es: '/es/ruta' },
        params: {},
    })
})
