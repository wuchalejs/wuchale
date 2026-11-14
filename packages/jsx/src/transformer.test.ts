// $ node --import ../../wuchale/testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { IndexTracker, URLHandler } from 'wuchale'
// @ts-expect-error
import { transformTest, ts as tsx } from '../../wuchale/testing/utils.ts'
import { defaultArgs, defaultRuntimeSolid } from './index.js'
import { JSXTransformer } from './transformer.js'

const urlHandler = new URLHandler([], 'en')
const catalogExpr = { plain: '_w_load_()', reactive: '_w_load_rx_()' }

const getOutput = (content: string, variant = 'default' as 'default' | 'solidjs') =>
    new JSXTransformer(
        {
            content,
            filename: 'test.tsx',
            index: new IndexTracker(true),
            expr: catalogExpr,
            matchUrl: urlHandler.match,
        },
        defaultArgs.heuristic,
        defaultArgs.patterns,
        variant === 'default' ? defaultArgs.runtime : defaultRuntimeSolid,
    ).transformJx(`@wuchale/jsx/runtime${variant === 'solidjs' ? '.solid' : ''}.jsx`, variant)

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
            const _w_runtime_ = _w_load_rx_();
            return <p>{_w_runtime_(0)}</p>
        }

        function m() {
            const _w_runtime_ = _w_load_();
            return <p data-novalue>{_w_runtime_(0)}</p>
        }
    `,
        ['Hello', 'Hello'],
    )
})

test('React arrow function component', async t => {
    transformTest(
        t,
        getOutput(tsx`
        const Foo = () => {
            return <p>Hello</p>
        }
        const m = () => {
            return <p data-novalue>Hello</p>
        }
    `),
        tsx`
        import { _w_load_, _w_load_rx_ } from "./loader.js"
        import W_tx_ from "@wuchale/jsx/runtime.jsx"

        const Foo = () => {
            const _w_runtime_ = _w_load_rx_();
            return <p>{_w_runtime_(0)}</p>
        }

        const m = () => {
            const _w_runtime_ = _w_load_();
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

        const _w_runtime_ = () => _w_load_rx_();
        function Foo(): Component {
            return <p>{_w_runtime_()(0)}</p>
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
            const _w_runtime_ = _w_load_();
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
                const _w_runtime_ = _w_load_();
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
                const _w_runtime_ = _w_load_();
                return <p>{plural(items, _w_runtime_.p(0), _w_runtime_.l)}</p>
            }
    `,
        [{ body: ['One item', '# items'] }],
    )
})

test('Nested and mixed', async (t: TestContext) => {
    const out = getOutput(tsx`
        function m() {
            return <>
                <p>Hello and <b>welcome to <i>the app {appName}</i></b>!</p>
            </>
        }
    `)
    t.assert.deepStrictEqual(out.txts[0]?.placeholders, [['0.0.0', 'appName']])
    transformTest(
        t,
        out,
        tsx`
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"
            function m() {
                const _w_runtime_ = _w_load_();
                return <>
                    <p><W_tx_ t={[_w_ctx_ => <b key="_0"><W_tx_ t={[_w_ctx_ => <i key="_1"><W_tx_ x={_w_ctx_} n a={[appName]} /></i>]} x={_w_ctx_} n /></b>]} x={_w_runtime_.c(0)} /></p>
                </>
            }
    `,
        ['Hello and <0>welcome to <0>the app {0}</0></0>!'],
    )
})

test('Nested elements inside expressions', async (t: TestContext) => {
    transformTest(
        t,
        getOutput(tsx`
            export function Probe({ a }: { a: boolean }) {
                return (
                    <div>
                        {a ? <div><hr /></div> : null}
                        <p>Hello world, this text is lost.</p>
                    </div>
                )
            }
        `),
        tsx`
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"

            export function Probe({ a }: { a: boolean }) {
                const _w_runtime_ = _w_load_rx_();
                return (
                    <div>
                        {a ? <div><hr /></div> : null}
                        <p>{_w_runtime_(0)}</p>
                    </div>
                )
            }
        `,
        ['Hello world, this text is lost.'],
    )

    transformTest(
        t,
        getOutput(tsx`
            function m(a: boolean, b: boolean) {
                return (
                    <div>
                        {a ? <div><hr /></div> : null}
                        {b ? (
                            <section>
                                {a ? <div><hr /></div> : null}
                                <span>First inner</span>
                            </section>
                        ) : (
                            <div><br /></div>
                        )}
                        <p>After expressions</p>
                        <span>Another sibling</span>
                    </div>
                )
            }
        `),
        tsx`
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"

            function m(a: boolean, b: boolean) {
                const _w_runtime_ = _w_load_();
                return (
                    <div>
                        {a ? <div><hr /></div> : null}
                        {b ? (
                            <section>
                                {a ? <div><hr /></div> : null}
                                <span>{_w_runtime_(0)}</span>
                            </section>
                        ) : (
                            <div><br /></div>
                        )}
                        <p>{_w_runtime_(1)}</p>
                        <span>{_w_runtime_(2)}</span>
                    </div>
                )
            }
        `,
        ['First inner', 'After expressions', 'Another sibling'],
    )

    transformTest(
        t,
        getOutput(tsx`
            function mixed(a: boolean) {
                return (
                    <>
                        <p>Prefix {a ? <span><b>bold</b></span> : <em>alt</em>} suffix</p>
                        <p>{a ? <div><span>inner text</span></div> : null} trailing text</p>
                        <p>Leading text {a ? <div><hr /></div> : null}</p>
                        <p>Outer {a ? <span>Inner <b>bold</b>!</span> : null} end</p>
                        <p>Click <Tooltip content={<div><span>Tip</span></div>}>here</Tooltip> to continue</p>
                        <p>Before <Layout header={<div><span>Header</span></div>} /> after</p>
                        <div>
                            <Layout header={<div><hr /></div>} />
                            <p>Main content</p>
                        </div>
                    </>
                )
            }
        `),
        tsx`
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"

            function mixed(a: boolean) {
                const _w_runtime_ = _w_load_();
                return (
                    <>
                        <p><W_tx_ x={_w_runtime_.c(7)} a={[a ? <span><b>{_w_runtime_(0)}</b></span> : <em>{_w_runtime_(1)}</em>]} /></p>
                        <p><W_tx_ x={_w_runtime_.c(8)} a={[a ? <div><span>{_w_runtime_(2)}</span></div> : null]} /></p>
                        <p><W_tx_ x={_w_runtime_.c(9)} a={[a ? <div><hr /></div> : null]} /></p>
                        <p><W_tx_ x={_w_runtime_.c(10)} a={[a ? <span><W_tx_ t={[_w_ctx_ => <b key="_0">{_w_runtime_.x(_w_ctx_)}</b>]} x={_w_runtime_.c(3)} /></span> : null]} /></p>
                        <p><W_tx_ t={[_w_ctx_ => <Tooltip key="_1" content={<div><span>{_w_runtime_(4)}</span></div>}>{_w_runtime_.x(_w_ctx_)}</Tooltip>]} x={_w_runtime_.c(11)} /></p>
                        <p><W_tx_ t={[() => <Layout header={<div><span>{_w_runtime_(5)}</span></div>} />]} x={_w_runtime_.c(13)} /></p>
                        <div>
                            <Layout header={<div><hr /></div>} />
                            <p>{_w_runtime_(6)}</p>
                        </div>
                    </>
                )
            }
        `,
        [
            'bold',
            'alt',
            'inner text',
            'Inner <0>bold</0>!',
            'Tip',
            'Header',
            'Main content',
            {
                body: 'Prefix {0} suffix',
                placeholders: [['0', 'a ? <span><b>bold</b></span> : <em>alt</em>']],
            },
            {
                body: '{0} trailing text',
                placeholders: [['0', 'a ? <div><span>inner text</span></div> : null']],
            },
            {
                body: 'Leading text {0}',
                placeholders: [['0', 'a ? <div><hr /></div> : null']],
            },
            {
                body: 'Outer {0} end',
                placeholders: [['0', 'a ? <span>Inner <b>bold</b>!</span> : null']],
            },
            'Click <0>here</0> to continue',
            'Before <0/> after',
        ],
    )
})
