// $$ cd .. && npm run test

import { test } from 'node:test'
import { getDefaultLoaderPath } from '@wuchale/jsx'
import { statfs } from 'fs/promises'
// @ts-expect-error
import { adapterOpts, testContent, tsx } from './check.ts'

test('Default loader file paths', async () => {
    for (const loader of ['default', 'react', 'solidjs']) {
        for (const bundle of [false, true]) {
            const path = getDefaultLoaderPath(loader, bundle)
            const paths = typeof path === 'string' ? [path] : Object.values(path ?? {})
            for (const path of paths) {
                await statfs(path) // no error
            }
        }
    }
})

test('React basic', async (t) => {
    await testContent(
        t,
        tsx`
        'use server'
        function Foo() {
            'use client'
            return <p>Hello</p>
        }
        function m() {
            return <p data-novalue>Hello</p>
        }
    `,
        tsx`
        'use server'
        import {getRuntime as _w_load_, getRuntimeRx as useW_load_rx_} from "../test-tmp/jsx.loader.js"
        import W_tx_ from "@wuchale/jsx/runtime.jsx"

        function Foo() {
            'use client'
            const _w_runtime_ = useW_load_rx_('jsx')
            return <p>{_w_runtime_(0)}</p>
        }

        function m() {
            const _w_runtime_ = _w_load_('jsx')
            return <p data-novalue>{_w_runtime_(0)}</p>
        }
    `,
        `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.jsx
    #: tests/test-dir/test.jsx
    msgid "Hello"
    msgstr "Hello"
    `,
        ['Hello'],
    )
})

test('SolidJS basic', async (t) => {
    await testContent(
        t,
        tsx`
        function Foo(): Component {
            return <p>Hello</p>
        }
    `,
        tsx`
        import {getRuntime as _w_load_, getRuntimeRx as useW_load_rx_} from "../test-tmp/jsx.loader.js"
        import W_tx_ from "@wuchale/jsx/runtime.solid.jsx"

        const _w_runtime_ = () => useW_load_rx_('jsx')

        function Foo(): Component {
            return <p>{_w_runtime_()(0)}</p>
        }
    `,
        `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.jsx
    msgid "Hello"
    msgstr "Hello"
    `,
        ['Hello'],
        undefined,
        { ...adapterOpts, variant: 'solidjs' },
    )
})

test('Ignore and include', async (t) => {
    await testContent(
        t,
        tsx`
        function foo() {
            return <div>
                <svg><path d="M100 200" /></svg>
                <p>{'hello there'}</p>
                {/* @wc-ignore */}
                <span>Ignore this</span>
                {/* @wc-include */}
                {'include this'}
            </div>
        }
    `,
        tsx`
        import {getRuntime as _w_load_, getRuntimeRx as useW_load_rx_} from "../test-tmp/jsx.loader.js"
        import W_tx_ from "@wuchale/jsx/runtime.jsx"

        function foo() {
            const _w_runtime_ = _w_load_('jsx')
            return <div>
                <svg><path d="M100 200" /></svg>
                <p>{'hello there'}</p>
                {/* @wc-ignore */}
                <span>Ignore this</span>
                {/* @wc-include */}
                {_w_runtime_(0)}
            </div>
        }
    `,
        `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.jsx
    msgid "include this"
    msgstr "include this"
    `,
        ['include this'],
    )
})

test('Ignore file', async (t) => {
    await testContent(
        t,
        tsx`
        // @wc-ignore-file
        function Foo() {
            return <p>Ignored</p>
        }
        function Bar() {
            return <p>Ignored</p>
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

test('Context', async (t) => {
    await testContent(
        t,
        tsx`
        const m = () => {
            return <>
                <p>{/* @wc-context: music */ 'String'}</p>
                <p>{/* @wc-context: programming */ 'String'}</p>
                {/* @wc-context: door */}
                <p>Close</p>
                {/* @wc-context: distance */}
                <p>Close</p>
            </>
        }`,
        tsx`
            import {getRuntime as _w_load_, getRuntimeRx as useW_load_rx_} from "../test-tmp/jsx.loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"

            const m = () => {
                const _w_runtime_ = _w_load_('jsx')
                return <>
                    <p>{/* @wc-context: music */ _w_runtime_(0)}</p>
                    <p>{/* @wc-context: programming */ _w_runtime_(1)}</p>
                    {/* @wc-context: door */}
                    <p>{_w_runtime_(2)}</p>
                    {/* @wc-context: distance */}
                    <p>{_w_runtime_(3)}</p>
                </>
            }`,
        `
        msgid ""
        msgstr ""

        #: tests/test-dir/test.jsx
        msgctxt "music"
        msgid "String"
        msgstr "String"

        #: tests/test-dir/test.jsx
        msgctxt "programming"
        msgid "String"
        msgstr "String"

        #: tests/test-dir/test.jsx
        msgctxt "door"
        msgid "Close"
        msgstr "Close"

        #: tests/test-dir/test.jsx
        msgctxt "distance"
        msgid "Close"
        msgstr "Close"
    `,
        ['String', 'String', 'Close', 'Close'],
    )
})

test('Plural', async (t) => {
    await testContent(
        t,
        tsx`
            function m() {
                return <p>{plural(items, ['One item', '# items'])}</p>
            }`,
        tsx`
            import {getRuntime as _w_load_, getRuntimeRx as useW_load_rx_} from "../test-tmp/jsx.loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"

            function m() {
                const _w_runtime_ = _w_load_('jsx')
                return <p>{plural(items, _w_runtime_.p(0), _w_runtime_._.p)}</p>
            }
    `,
        `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.jsx
    msgid "One item"
    msgid_plural "# items"
    msgstr[0] "One item"
    msgstr[1] "# items"
    `,
        [['One item', '# items']],
    )
})

test('Nested and mixed', async (t) => {
    await testContent(
        t,
        tsx`
            function m() {
                return <>
                    <p>Hello and <b>welcome</b> to <i>the app</i>!</p>
                    <p>{num} messages</p>
                </>
            }`,
        tsx`
            import {getRuntime as _w_load_, getRuntimeRx as useW_load_rx_} from "../test-tmp/jsx.loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"

            function m() {
                const _w_runtime_ = _w_load_('jsx')
                return <>
                    <p><W_tx_ t={[_w_ctx_ => <b key="_0">{_w_runtime_.x(_w_ctx_)}</b>, _w_ctx_ => <i key="_1">{_w_runtime_.x(_w_ctx_)}</i>]} x={_w_runtime_.c(0)} /></p>
                    <p><W_tx_ x={_w_runtime_.c(1)} a={[num]} /></p>
                </>
            }
    `,
        `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.jsx
    msgid "Hello and <0>welcome</0> to <1>the app</1>!"
    msgstr "Hello and <0>welcome</0> to <1>the app</1>!"

    #. placeholder {0}: num
    #: tests/test-dir/test.jsx
    msgid "{0} messages"
    msgstr "{0} messages"
    `,
        [
            ['Hello and ', [0, 'welcome'], ' to ', [1, 'the app'], '!'],
            [0, ' messages'],
        ],
    )
})
