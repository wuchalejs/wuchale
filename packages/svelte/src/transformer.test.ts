// $ node --import ../../wuchale/testing/resolve.ts %f

import { test } from 'node:test'
import { IndexTracker, type RuntimeConf, URLHandler } from 'wuchale'
// @ts-expect-error
import { ts as svelte, transformTest, ts } from '../../wuchale/testing/utils.ts'
import { defaultArgs } from './index.js'
import { SvelteTransformer } from './transformer.js'

const urlHandler = new URLHandler({
    patterns: ['/translated/*rest', '/'],
    localize: true,
})
const catalogExpr = { plain: '_w_load_()', reactive: '_w_load_rx_()' }

const getOutput = (content: string, filename = 'test.svelte') =>
    new SvelteTransformer(
        content,
        filename,
        new IndexTracker(),
        defaultArgs.heuristic,
        defaultArgs.patterns,
        catalogExpr,
        defaultArgs.runtime as RuntimeConf,
        urlHandler.match,
    ).transformSv()

test('Simple text', async t => {
    transformTest(
        t,
        await getOutput(svelte`Hello`),
        svelte`
        <script>
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/svelte/runtime.svelte"
            const _w_runtime_ = $derived(_w_load_rx_())
        </script>
        {_w_runtime_(0)}
    `,
        ['Hello'],
    )
})

test('JS module files', async t => {
    transformTest(
        t,
        await getOutput(
            ts`
            const varName = 'Simple bare assign'
            'No translation!' // simple expression
            const alreadyDerived = $derived(call('Foo'))
            noExtract('Foo')
            const msg = $derived('Hello')

            function foo() {
                return 'Should extract'
            }
        `,
            'test.svelte.js',
        ),
        ts`
        import { _w_load_, _w_load_rx_ } from "./loader.js"
        const _w_runtime_ = $derived(_w_load_rx_())

        const varName = $derived(_w_runtime_(0))
        'No translation!' // simple expression
        const alreadyDerived = $derived(call(_w_runtime_(1)))
        noExtract('Foo')
        const msg = $derived(_w_runtime_(2))

        function foo() {
            const _w_runtime_ = _w_load_()
            return _w_runtime_(3)
        }
    `,
        ['Simple bare assign', 'Foo', 'Hello', 'Should extract'],
    )
})

test('Simple element with new lines', async t => {
    transformTest(
        t,
        await getOutput(svelte`
            <script>
                // Intentionally empty
            </script>
            <p title={loggedIn && 'Hello'}>
                Hello
                There
            </p>`),
        svelte`
        <script>
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/svelte/runtime.svelte"
            const _w_runtime_ = $derived(_w_load_rx_())
            // Intentionally empty
        </script>
        <p title={loggedIn && _w_runtime_(0)}>
            {_w_runtime_(1)}
        </p>
    `,
        ['Hello', 'Hello\nThere'],
    )
})

test('Ignore and include', async t => {
    transformTest(
        t,
        await getOutput(svelte`
        <div>
            <svg><path d="M100 200" /></svg>
            <p>{'hello there'}</p>
            <!-- @wc-ignore -->
            <span>Ignore this</span>
            <!-- @wc-include -->
            {'include this'}
        </div>
    `),
        svelte`
        <script>
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/svelte/runtime.svelte"
            const _w_runtime_ = $derived(_w_load_rx_())
        </script>
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

test('Ignore file', async t => {
    transformTest(
        t,
        await getOutput(svelte`
        <!-- @wc-ignore-file -->
        <p>Ignored</p>
        <p>Ignored</p>
        <p>Ignored</p>
    `),
        undefined,
        [],
    )
})

test('URLs', async t => {
    transformTest(
        t,
        await getOutput(svelte`
        <script>
            goto(\`/translated/\${44}\`)
            const url = {
                // @wc-url
                something: [\`/translated/somewhere/\${45}\`]
            }
        </script>
        <a href="/translated/hello">Hello</a>
        <a href={'/translated/hello/there'}>Hello</a>
        <a href="/translated/very/deep/link/{44}">Hello</a>
        <a href={\`/translated/\${44}\`}>Hello</a>
        <a href="/notinpattern">Hello</a>
        <a href="/">Hello</a>
    `),
        svelte`
        <script>
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/svelte/runtime.svelte"
            const _w_runtime_ = $derived(_w_load_rx_())
            goto(_w_runtime_(0, [44]))
            const url = $derived({
                // @wc-url
                something: [_w_runtime_(1, [45])]
            })
        </script>
        <a href={_w_runtime_(2)}>{_w_runtime_(3)}</a>
        <a href={_w_runtime_(4)}>{_w_runtime_(3)}</a>
        <a href={_w_runtime_(5, [44])}>{_w_runtime_(3)}</a>
        <a href={_w_runtime_(0, [44])}>{_w_runtime_(3)}</a>
        <a href="/notinpattern">{_w_runtime_(3)}</a>
        <a href={_w_runtime_(6)}>{_w_runtime_(3)}</a>
    `,
        [
            { msgStr: ['/translated/{0}'], type: 'url' },
            { msgStr: ['/translated/somewhere/{0}'], type: 'url' },
            { msgStr: ['/translated/hello'], type: 'url' },
            'Hello',
            { msgStr: ['/translated/hello/there'], type: 'url' },
            'Hello',
            { msgStr: ['/translated/very/deep/link/{0}'], type: 'url' },
            'Hello',
            { msgStr: ['/translated/{0}'], type: 'url' },
            'Hello',
            'Hello',
            { msgStr: ['/'], type: 'url' },
            'Hello',
        ],
    )
})

test('SCSS no problem', async t => {
    transformTest(
        t,
        await getOutput(svelte`
        <style lang="scss">
          $primary: #4caf50;

          button {
            color: $primary;
            font-weight: bold;
          }
        </style>
    `),
        undefined,
        [],
    )
})

test('Exported snippet', async t => {
    transformTest(
        t,
        await getOutput(svelte`
        <script module>
            export const bar = {
                feel: () => {
					const msg = 'Hello'
                    return foo
                }
            }
        </script>

        {#snippet foo()}
            <div>Hello</div>
        {/snippet}
    `),
        svelte`
        <script module>
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/svelte/runtime.svelte"
            const _w_runtime_mod_ = $derived(_w_load_rx_())
            export const bar = {
                feel: () => {
					const _w_runtime_mod_ = _w_load_()
					const msg = _w_runtime_mod_(0)
                    return foo
                }
            }
        </script>

        <script>
            const _w_runtime_ = $derived(_w_load_rx_())
        </script>

        {#snippet foo()}
            <div>{_w_runtime_mod_(0)}</div>
        {/snippet}
    `,
        ['Hello', 'Hello'],
    )
})

test('Context', async t => {
    transformTest(
        t,
        await getOutput(svelte`
            <p>{/* @wc-context: music */ 'String'}</p>
            <p>{/* @wc-context: programming */ 'String'}</p>
            <!-- @wc-context: door -->
            <p>Close</p>
            <!-- @wc-context: distance -->
            <p>Close</p>
        `),
        svelte`
            <script>
            import { _w_load_, _w_load_rx_ } from "./loader.js"
                import W_tx_ from "@wuchale/svelte/runtime.svelte"
                const _w_runtime_ = $derived(_w_load_rx_())
            </script>
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
