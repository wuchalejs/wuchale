// $ node --import ../../wuchale/testing/resolve.ts %f

import { test } from 'node:test'
import { IndexTracker, type RuntimeConf, URLHandler } from 'wuchale'
// @ts-expect-error
import { transformTest, ts as tsx } from '../../wuchale/testing/utils.ts'
import { defaultArgs } from './index.js'
import { JSXTransformer } from './transformer.js'

const urlHandler = new URLHandler([])
const catalogExpr = { plain: '_w_load_()', reactive: '_w_load_rx_()' }

const getOutput = (content: string, variant = 'default' as 'default' | 'solidjs') =>
    new JSXTransformer(
        content,
        'test.tsx',
        new IndexTracker(),
        defaultArgs.heuristic,
        defaultArgs.patterns,
        catalogExpr,
        defaultArgs.runtime as RuntimeConf,
        urlHandler.match,
    ).transformJx(variant)

test('React basic', async t => {
    transformTest(
        t,
        getOutput(tsx`
        'use server'
        function Foo() {
            'use client'
            return <p>Hello</p>
        }
        function m() {
            return <p data-novalue>Hello</p>
        }
    `),
        tsx`
        'use server'
        import { _w_load_, _w_load_rx_ } from "./loader.js"
        import W_tx_ from "@wuchale/jsx/runtime.jsx"

        function Foo() {
            'use client'
            const _w_runtime_ = _w_load_rx_()
            return <p>{_w_runtime_(0)}</p>
        }

        function m() {
            const _w_runtime_ = _w_load_()
            return <p data-novalue>{_w_runtime_(0)}</p>
        }
    `,
        ['Hello', 'Hello'],
    )
})

test('SolidJS basic', async t => {
    transformTest(
        t,
        getOutput(
            tsx`
        function Foo(): Component {
            return <p>Hello</p>
        }
    `,
            'solidjs' as const,
        ),
        tsx`
        import { _w_load_, _w_load_rx_ } from "./loader.js"
        import W_tx_ from "@wuchale/jsx/runtime.solid.jsx"

        function Foo(): Component {
            const _w_runtime_ = _w_load_rx_()
            return <p>{_w_runtime_(0)}</p>
        }
    `,
        ['Hello'],
    )
})

test('Ignore and include', async t => {
    transformTest(
        t,
        getOutput(tsx`
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
    `),
        tsx`
        import { _w_load_, _w_load_rx_ } from "./loader.js"
        import W_tx_ from "@wuchale/jsx/runtime.jsx"

        function foo() {
            const _w_runtime_ = _w_load_()
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
        ['include this'],
    )
})

test('Ignore file', async t => {
    transformTest(
        t,
        getOutput(tsx`
        // @wc-ignore-file
        function Foo() {
            return <p>Ignored</p>
        }
        function Bar() {
            return <p>Ignored</p>
        }
    `),
        undefined,
        [],
    )
})

test('Context', async t => {
    transformTest(
        t,
        getOutput(tsx`
        const m = () => {
            return <>
                <p>{/* @wc-context: music */ 'String'}</p>
                <p>{/* @wc-context: programming */ 'String'}</p>
                {/* @wc-context: door */}
                <p>Close</p>
                {/* @wc-context: distance */}
                <p>Close</p>
            </>
        }`),
        tsx`
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"

            const m = () => {
                const _w_runtime_ = _w_load_()
                return <>
                    <p>{/* @wc-context: music */ _w_runtime_(0)}</p>
                    <p>{/* @wc-context: programming */ _w_runtime_(1)}</p>
                    {/* @wc-context: door */}
                    <p>{_w_runtime_(2)}</p>
                    {/* @wc-context: distance */}
                    <p>{_w_runtime_(3)}</p>
                </>
            }`,
        ['String', 'String', 'Close', 'Close'],
    )
})

test('Plural', async t => {
    transformTest(
        t,
        getOutput(tsx`
            function m() {
                return <p>{plural(items, ['One item', '# items'])}</p>
            }`),
        tsx`
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"

            function m() {
                const _w_runtime_ = _w_load_()
                return <p>{plural(items, _w_runtime_.p(0), _w_runtime_._.p)}</p>
            }
    `,
        [{ msgStr: ['One item', '# items'] }],
    )
})

test('Nested and mixed', async t => {
    transformTest(
        t,
        getOutput(tsx`
            function m() {
                return <>
                    <p>Hello and <b>welcome</b> to <i>the app</i>!</p>
                    <p>{num} messages</p>
                </>
            }`),
        tsx`
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"

            function m() {
                const _w_runtime_ = _w_load_()
                return <>
                    <p><W_tx_ t={[_w_ctx_ => <b key="_0">{_w_runtime_.x(_w_ctx_)}</b>, _w_ctx_ => <i key="_1">{_w_runtime_.x(_w_ctx_)}</i>]} x={_w_runtime_.c(0)} /></p>
                    <p><W_tx_ x={_w_runtime_.c(1)} a={[num]} /></p>
                </>
            }
    `,
        ['Hello and <0>welcome</0> to <1>the app</1>!', '{0} messages'],
    )
})
