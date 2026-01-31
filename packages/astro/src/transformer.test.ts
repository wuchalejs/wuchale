// $ node --import ../../wuchale/testing/resolve.ts %f

import { test } from 'node:test'
import { IndexTracker, type RuntimeConf, URLHandler } from 'wuchale'
// @ts-expect-error
import { ts as astro, transformTest } from '../../wuchale/testing/utils.ts'
import { defaultArgs } from './index.js'
import { AstroTransformer } from './transformer.js'

const urlHandler = new URLHandler({
    patterns: ['/translated/*rest', '/'],
    localize: true,
})
const catalogExpr = { plain: '_w_load_()', reactive: '_w_load_rx_()' }

const getOutput = (content: string, filename = 'test.astro') =>
    new AstroTransformer(
        content,
        filename,
        new IndexTracker(),
        defaultArgs.heuristic,
        defaultArgs.patterns,
        catalogExpr,
        defaultArgs.runtime as RuntimeConf,
        urlHandler.match,
    ).transformAs()

test('Basic markup with unicode', async t => {
    transformTest(
        t,
        await getOutput(astro`
        <p>Hello 😋</p>
        <p data-novalue>Hello</p>
    `),
        astro`
        ---
        import { _w_load_, _w_load_rx_ } from "./loader.js"
        import _w_Tx_ from "@wuchale/astro/runtime.js"
        const _w_runtime_ = _w_load_()
        ---
        <p>{_w_runtime_(0)}</p>
        <p data-novalue>{_w_runtime_(1)}</p>
    `,
        ['Hello 😋', 'Hello'],
    )
})

test('Comment before frontmatter', async t => {
    transformTest(
        t,
        await getOutput(astro`
        <!-- foo -->
        ---
        ---
        <p>Hello</p>
    `),
        astro`
        <!-- foo -->
        ---
        import { _w_load_, _w_load_rx_ } from "./loader.js"
        import _w_Tx_ from "@wuchale/astro/runtime.js"
        const _w_runtime_ = _w_load_()
        ---
        <p>{_w_runtime_(0)}</p>
    `,
        ['Hello'],
    )
})

test('Ignore and include', async t => {
    transformTest(
        t,
        await getOutput(astro`
        <div>
            <svg><path d="M100 200" /></svg>
            <p>{'hello there'}</p>
            <!-- @wc-ignore -->
            <span>Ignore this</span>
            <!-- @wc-include -->
            {'include this'}
        </div>
    `),
        astro`
        ---
        import { _w_load_, _w_load_rx_ } from "./loader.js"
        import _w_Tx_ from "@wuchale/astro/runtime.js"
        const _w_runtime_ = _w_load_()
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
        ['include this'],
    )
})

test('Object attributes', async t => {
    transformTest(
        t,
        await getOutput(astro`<Comp objProps={{foo: 'Hello', bar: 67}} {...foo['Hello']} />`),
        astro`
        ---
        import { _w_load_, _w_load_rx_ } from "./loader.js"
        import _w_Tx_ from "@wuchale/astro/runtime.js"
        const _w_runtime_ = _w_load_()
        ---
        <Comp objProps={{foo: _w_runtime_(0), bar: 67}} {...foo[_w_runtime_(0)]} />
    `,
        ['Hello', 'Hello'],
    )
})

test('Frontmatter return', async t => {
    transformTest(
        t,
        await getOutput(astro`
            ---
            return Astro.rewrite("/404");
            ---
    `),
        undefined,
        [],
    )
})

test('Ignore file', async t => {
    transformTest(
        t,
        await getOutput(astro`
        <!-- @wc-ignore-file -->
        <p>Ignored</p>
        <p>Ignored</p>
    `),
        undefined,
        [],
    )
})

test('Context', async t => {
    transformTest(
        t,
        await getOutput(astro`
            <p>{/* @wc-context: music */ 'String'}</p>
            <p>{/* @wc-context: programming */ 'String'}</p>
            <!-- @wc-context: door -->
            <p>Close</p>
            <!-- @wc-context: distance -->
            <p>Close</p>
        `),
        astro`
            ---
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import _w_Tx_ from "@wuchale/astro/runtime.js"
            const _w_runtime_ = _w_load_()
            ---
            <p>{/* @wc-context: music */ _w_runtime_(0)}</p>
            <p>{/* @wc-context: programming */ _w_runtime_(1)}</p>
            <!-- @wc-context: door -->
            <p>{_w_runtime_(2)}</p>
            <!-- @wc-context: distance -->
            <p>{_w_runtime_(3)}</p>
            `,
        ['String', 'String', 'Close', 'Close'],
    )
})

test('Plural', async t => {
    transformTest(
        t,
        await getOutput(astro`
            <p>{plural(items, ['One item', '# items'])}</p>
            `),
        astro`
            ---
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import _w_Tx_ from "@wuchale/astro/runtime.js"
            const _w_runtime_ = _w_load_()
            ---
            <p>{plural(items, _w_runtime_.p(0), _w_runtime_._.p)}</p>
    `,
        [{ msgStr: ['One item', '# items'] }],
    )
})

test('Nested and mixed', async t => {
    transformTest(
        t,
        await getOutput(astro`
            <p>Hello and <b>welcome</b> to <i>the app</i>!</p>
            <p>{num} messages</p>
        `),
        astro`
            ---
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import _w_Tx_ from "@wuchale/astro/runtime.js"
            const _w_runtime_ = _w_load_()
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
        ['Hello and <0>welcome</0> to <1>the app</1>!', '{0} messages'],
    )
})
