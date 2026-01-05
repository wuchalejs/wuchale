// $$ cd .. && npm run test

import { test } from 'node:test'
import { getDefaultLoaderPath } from '@wuchale/jsx'
import { statfs } from 'fs/promises'
// @ts-expect-error
import { astro, testContent } from './check.ts'

test('Default loader file paths', async () => {
    for (const loader of ['default']) {
        for (const bundle of [false, true]) {
            const path = getDefaultLoaderPath(loader, bundle)
            const paths = typeof path === 'string' ? [path] : Object.values(path ?? {})
            for (const path of paths) {
                await statfs(path) // no error
            }
        }
    }
})

test('Basic markup', async t => {
    await testContent(
        t,
        astro`
        <p>Hello</p>
        <p data-novalue>Hello</p>
    `,
        astro`
        ---
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/astro.loader.js"
        import _w_Tx_ from "@wuchale/astro/runtime.js"
        const _w_runtime_ = _w_load_('astro')
        ---
        <p>{_w_runtime_(0)}</p>
        <p data-novalue>{_w_runtime_(0)}</p>
    `,
        `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    #: tests/test-dir/test.astro
    msgid "Hello"
    msgstr "Hello"
    `,
        ['Hello'],
    )
})

test('Comment before frontmatter', async t => {
    await testContent(
        t,
        astro`
        <!-- foo -->
        ---
        ---
        <p>Hello</p>
    `,
        astro`
        <!-- foo -->
        ---
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/astro.loader.js"
        import _w_Tx_ from "@wuchale/astro/runtime.js"
        const _w_runtime_ = _w_load_('astro')
        ---
        <p>{_w_runtime_(0)}</p>
    `,
        `
    msgid ""
    msgstr ""
    #: tests/test-dir/test.astro
    msgid "Hello"
    msgstr "Hello"
    `,
        ['Hello'],
    )
})

test('Ignore and include', async t => {
    await testContent(
        t,
        astro`
        <div>
            <svg><path d="M100 200" /></svg>
            <p>{'hello there'}</p>
            <!-- @wc-ignore -->
            <span>Ignore this</span>
            <!-- @wc-include -->
            {'include this'}
        </div>
    `,
        astro`
        ---
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/astro.loader.js"
        import _w_Tx_ from "@wuchale/astro/runtime.js"
        const _w_runtime_ = _w_load_('astro')
        ---
        <div>
            <svg><path d="M100 200" /></svg>
            <p>{'hello there'}</p>
            <!-- @wc-ignore -->
            <span>Ignore this</span>
            <!-- @wc-include -->
            {_w_runtime_(0)}
        </div>
    `,
        `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.astro
    msgid "include this"
    msgstr "include this"
    `,
        ['include this'],
    )
})

test('Object attributes', async t => {
    await testContent(
        t,
        astro`<Comp objProps={{foo: 'Hello', bar: 67}} {...foo['Hello']} />`,
        astro`
        ---
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/astro.loader.js"
        import _w_Tx_ from "@wuchale/astro/runtime.js"
        const _w_runtime_ = _w_load_('astro')
        ---
        <Comp objProps={{foo: _w_runtime_(0), bar: 67}} {...foo[_w_runtime_(0)]} />
    `,
        `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.astro
    #: tests/test-dir/test.astro
    msgid "Hello"
    msgstr "Hello"
    `,
        ['Hello'],
    )
})

test('Frontmatter return', async t => {
    await testContent(
        t,
        astro`
            ---
            return Astro.rewrite("/404");
            ---
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
        astro`
        <!-- @wc-ignore-file -->
        <p>Ignored</p>
        <p>Ignored</p>
    `,
        undefined,
        `
    msgid ""
    msgstr ""
    `,
        [],
    )
})

test('Context', async t => {
    await testContent(
        t,
        astro`
            <p>{/* @wc-context: music */ 'String'}</p>
            <p>{/* @wc-context: programming */ 'String'}</p>
            <!-- @wc-context: door -->
            <p>Close</p>
            <!-- @wc-context: distance -->
            <p>Close</p>
        `,
        astro`
            ---
            import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/astro.loader.js"
            import _w_Tx_ from "@wuchale/astro/runtime.js"
            const _w_runtime_ = _w_load_('astro')
            ---
            <p>{/* @wc-context: music */ _w_runtime_(0)}</p>
            <p>{/* @wc-context: programming */ _w_runtime_(1)}</p>
            <!-- @wc-context: door -->
            <p>{_w_runtime_(2)}</p>
            <!-- @wc-context: distance -->
            <p>{_w_runtime_(3)}</p>
            `,
        `
        msgid ""
        msgstr ""

        #: tests/test-dir/test.astro
        msgctxt "music"
        msgid "String"
        msgstr "String"

        #: tests/test-dir/test.astro
        msgctxt "programming"
        msgid "String"
        msgstr "String"

        #: tests/test-dir/test.astro
        msgctxt "door"
        msgid "Close"
        msgstr "Close"

        #: tests/test-dir/test.astro
        msgctxt "distance"
        msgid "Close"
        msgstr "Close"
    `,
        ['String', 'String', 'Close', 'Close'],
    )
})

test('Plural', async t => {
    await testContent(
        t,
        astro`
            <p>{plural(items, ['One item', '# items'])}</p>
            `,
        astro`
            ---
            import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/astro.loader.js"
            import _w_Tx_ from "@wuchale/astro/runtime.js"
            const _w_runtime_ = _w_load_('astro')
            ---
            <p>{plural(items, _w_runtime_.p(0), _w_runtime_._.p)}</p>
    `,
        `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.astro
    msgid "One item"
    msgid_plural "# items"
    msgstr[0] "One item"
    msgstr[1] "# items"
    `,
        [['One item', '# items']],
    )
})

test('Nested and mixed', async t => {
    await testContent(
        t,
        astro`
            <p>Hello and <b>welcome</b> to <i>the app</i>!</p>
            <p>{num} messages</p>
        `,
        astro`
            ---
            import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../test-tmp/astro.loader.js"
            import _w_Tx_ from "@wuchale/astro/runtime.js"
            const _w_runtime_ = _w_load_('astro')
            ---
            <p>{_w_Tx_({
                x: _w_runtime_.c(0),
                t: [_w_ctx_ => <b>{_w_runtime_.x(_w_ctx_)}</b>, _w_ctx_ => <i>{_w_runtime_.x(_w_ctx_)}</i>]
            })}</p>
            <p>{_w_Tx_({
                x: _w_runtime_.c(1),
                a: [num]
            })}</p>
    `,
        `
    msgid ""
    msgstr ""

    #: tests/test-dir/test.astro
    msgid "Hello and <0>welcome</0> to <1>the app</1>!"
    msgstr "Hello and <0>welcome</0> to <1>the app</1>!"

    #. placeholder {0}: num
    #: tests/test-dir/test.astro
    msgid "{0} messages"
    msgstr "{0} messages"
    `,
        [
            ['Hello and ', [0, 'welcome'], ' to ', [1, 'the app'], '!'],
            [0, ' messages'],
        ],
    )
})
