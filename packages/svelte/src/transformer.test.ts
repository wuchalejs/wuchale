// $ node --import ../../wuchale/testing/resolve.ts %f

import { test } from 'node:test'
import { IndexTracker, type RuntimeConf, URLHandler } from 'wuchale'
// @ts-expect-error
import { ts as svelte, transformTest, ts } from '../../wuchale/testing/utils.ts'
import { defaultArgs, svelteKitDefaultHeuristic } from './index.js'
import { SvelteTransformer } from './transformer.js'

const urlHandler = new URLHandler(['en'], 'en', {
    patterns: ['/translated/*rest', '/'],
    localize: true,
})

const catalogExpr = { plain: '_w_load_()', reactive: '_w_load_rx_()' }

const getOutput = (content: string, filename = 'test.svelte') =>
    new SvelteTransformer(
        content,
        filename,
        new IndexTracker(),
        svelteKitDefaultHeuristic,
        defaultArgs.patterns,
        catalogExpr,
        defaultArgs.runtime as RuntimeConf,
        urlHandler.match,
    ).transformSv()

test('Simple text and props destruct', async t => {
    transformTest(
        t,
        await getOutput(svelte`
        <script>
            let { label = 'Hello' } = $props()
        </script>
        Hello
        `),
        svelte`
        <script>
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/svelte/runtime.svelte"
            const _w_runtime_ = $derived(_w_load_rx_());
            let { label = _w_runtime_(0) } = $props()
        </script>
        {_w_runtime_(0)}
    `,
        ['Hello', 'Hello'],
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
        const _w_runtime_ = $derived(_w_load_rx_());

        const varName = $derived(_w_runtime_(0))
        'No translation!' // simple expression
        const alreadyDerived = $derived(call(_w_runtime_(1)))
        noExtract('Foo')
        const msg = $derived(_w_runtime_(2))

        function foo() {
            const _w_runtime_ = _w_load_();
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
            const _w_runtime_ = $derived(_w_load_rx_());
            // Intentionally empty
        </script>
        <p title={loggedIn && _w_runtime_(0)}>
            {_w_runtime_(1)}
        </p>
    `,
        ['Hello', 'Hello There'],
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
            const _w_runtime_ = $derived(_w_load_rx_());
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

test('Keep as single unit', async t => {
    transformTest(
        t,
        await getOutput(svelte`
        <!-- @wc-unit -->
        <div>
            <p>Parag 1</p>
            <p>Parag 2</p>
            <p>Parag 3</p>
        </div>
    `),
        svelte`
        <script>
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/svelte/runtime.svelte"
            const _w_runtime_ = $derived(_w_load_rx_());
        </script>
        <!-- @wc-unit -->
        <div>
            {#snippet _w_snippet_0(_w_ctx_)}
            <p>{_w_runtime_.x(_w_ctx_)}</p>
            {/snippet}
            {#snippet _w_snippet_1(_w_ctx_)}
            <p>{_w_runtime_.x(_w_ctx_)}</p>
            {/snippet}
            {#snippet _w_snippet_2(_w_ctx_)}
            <p>{_w_runtime_.x(_w_ctx_)}</p>
            {/snippet}
            <W_tx_ t={[_w_snippet_0, _w_snippet_1, _w_snippet_2]} x={_w_runtime_.c(0)} />
        </div>
    `,
        ['<0>Parag 1</0> <1>Parag 2</1> <2>Parag 3</2>'],
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
            const _w_runtime_ = $derived(_w_load_rx_());
            goto(_w_localize_(_w_runtime_(0, [44]), _w_runtime_.l))
            const url = $derived({
                // @wc-url
                something: [_w_localize_(_w_runtime_(1, [45]), _w_runtime_.l)]
            })
        </script>
        <a href={_w_localize_(_w_runtime_(2), _w_runtime_.l)}>{_w_runtime_(3)}</a>
        <a href={_w_localize_(_w_runtime_(4), _w_runtime_.l)}>{_w_runtime_(3)}</a>
        <a href={_w_localize_(_w_runtime_(5, [44]), _w_runtime_.l)}>{_w_runtime_(3)}</a>
        <a href={_w_localize_(_w_runtime_(0, [44]), _w_runtime_.l)}>{_w_runtime_(3)}</a>
        <a href="/notinpattern">{_w_runtime_(3)}</a>
        <a href={_w_localize_(_w_runtime_(6), _w_runtime_.l)}>{_w_runtime_(3)}</a>
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
            const _w_runtime_mod_ = $derived(_w_load_rx_());
            export const bar = {
                feel: () => {
					const _w_runtime_mod_ = _w_load_();
					const msg = _w_runtime_mod_(0)
                    return foo
                }
            }
        </script>

        <script>
            const _w_runtime_ = $derived(_w_load_rx_());
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
                const _w_runtime_ = $derived(_w_load_rx_());
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

test('Tags and directives', async t => {
    transformTest(
        t,
        await getOutput(svelte`
            {@render foo('Hello')}
            {@html 'Hello'}
            <button on:click={() => alert('Hello')}>42</button>
        `),
        svelte`
        <script>
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/svelte/runtime.svelte"
            const _w_runtime_ = $derived(_w_load_rx_());
        </script>
            {@render foo(_w_runtime_(0))}
            {@html _w_runtime_(0)}
            <button on:click={() => alert(_w_runtime_(0))}>42</button>
    `,
        ['Hello', 'Hello', 'Hello'],
    )
})

test('Nested and mixed', async t => {
    transformTest(
        t,
        await getOutput(svelte`
            <p>Hello and <b>welcome to <i>the app {appName}</i></b>!</p>
        `),
        svelte`
        <script>
            import { _w_load_, _w_load_rx_ } from "./loader.js"
            import W_tx_ from "@wuchale/svelte/runtime.svelte"
            const _w_runtime_ = $derived(_w_load_rx_());
        </script>
        <p>
            {#snippet _w_snippet_1(_w_ctx_)}
                <b>
                {#snippet _w_snippet_0(_w_ctx_)}
                    <i>
                        <W_tx_ x={_w_ctx_} n a={[appName]} />
                    </i>
                {/snippet}
                <W_tx_ t={[_w_snippet_0]} x={_w_ctx_} n />
            </b>
            {/snippet}
            <W_tx_ t={[_w_snippet_1]} x={_w_runtime_.c(0)} />
        </p>
    `,
        ['Hello and <0>welcome to <0>the app {0}</0></0>!'],
    )
})
