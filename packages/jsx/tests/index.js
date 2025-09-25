// $$ cd .. && npm run test

import { test } from 'node:test'
import { testContent, testDir, tsx, adapterOpts } from './check.js'
import { adapter } from '@wuchale/jsx'
import { statfs } from 'fs/promises'

test('Default loader file paths', async function(t){
    const adap = adapter()
    for (const loader of ['default', 'react', 'react.bundle', 'solidjs', 'solidjs.bundle']) {
        const path = adap.defaultLoaderPath(loader)
        const paths = typeof path === 'string' ? [path] : Object.values(path)
        for (const path of paths) {
            await statfs(path) // no error
        }
    }
})

test('React basic', async function(t) {
    await testContent(t, tsx`
        'use server'
        function Foo() {
            'use client'
            return <p>Hello</p>
        }
        function m() {
            return <p data-novalue>Hello</p>
        }
    `, tsx`
        'use server'
        import _w_to_rt_ from 'wuchale/runtime'
        import _w_load_rx_,{get as _w_load_} from "../tests/test-tmp/loader.js"
        import W_tx_ from "@wuchale/jsx/runtime.jsx"

        function Foo() {
            'use client'
            const _w_runtime_ = _w_to_rt_(_w_load_rx_('jsx'))
            return <p>{_w_runtime_.t(0)}</p>
        }

        function m() {
            const _w_runtime_ = _w_to_rt_(_w_load_('jsx'))
            return <p data-novalue>{_w_runtime_.t(0)}</p>
        }
    `, `
    msgid ""
    msgstr ""
    #: test-tmp/test.jsx
    #: test-tmp/test.jsx
    msgid "Hello"
    msgstr "Hello"
    `, ['Hello'])
})

test('SolidJS basic', async function(t) {
    await testContent(t, tsx`
        function Foo(): Component {
            return <p>Hello</p>
        }
    `, tsx`
        import _w_to_rt_ from 'wuchale/runtime'
        import _w_load_rx_,{get as _w_load_} from "../tests/test-tmp/loader.js"
        import W_tx_ from "@wuchale/jsx/runtime.solid.jsx"

        const _w_runtime_ = () => _w_to_rt_(_w_load_rx_('jsx'))

        function Foo(): Component {
            return <p>{_w_runtime_().t(0)}</p>
        }
    `, `
    msgid ""
    msgstr ""
    #: test-tmp/test.jsx
    msgid "Hello"
    msgstr "Hello"
    `, ['Hello'], null, {...adapterOpts, variant: 'solidjs'})
})

test('Ignore and include', async function(t) {
    await testContent(t, tsx`
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
    `, tsx`
        import _w_to_rt_ from 'wuchale/runtime'
        import _w_load_rx_,{get as _w_load_} from "../tests/test-tmp/loader.js"
        import W_tx_ from "@wuchale/jsx/runtime.jsx"

        function foo() {
            const _w_runtime_ = _w_to_rt_(_w_load_('jsx'))
            return <div>
                <svg><path d="M100 200" /></svg>
                <p>{'hello there'}</p>
                {/* @wc-ignore */}
                <span>Ignore this</span>
                {/* @wc-include */}
                {_w_runtime_.t(0)}
            </div>
        }
    `, `
    msgid ""
    msgstr ""

    #: test-tmp/test.jsx
    msgid "include this"
    msgstr "include this"
    `, ['include this'])
})

test('Ignore file', async function(t) {
    await testContent(t, tsx`
        // @wc-ignore-file
        function Foo() {
            return <p>Ignored</p>
        }
        function Bar() {
            return <p>Ignored</p>
        }
    `, undefined, `
    msgid ""
    msgstr ""
    `, [])
})

test('Context', async function(t) {
    await testContent(t, tsx`
        const m = () => {
            return <>
                <p>{/* @wc-context: music */ 'String'}</p>
                <p>{/* @wc-context: programming */ 'String'}</p>
                {/* @wc-context: door */}
                <p>Close</p>
                {/* @wc-context: distance */}
                <p>Close</p>
            </>
        }`, tsx`
            import _w_to_rt_ from 'wuchale/runtime'
            import _w_load_rx_,{get as _w_load_} from "../tests/test-tmp/loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"

            const m = () => {
                const _w_runtime_ = _w_to_rt_(_w_load_('jsx'))
                return <>
                    <p>{/* @wc-context: music */ _w_runtime_.t(0)}</p>
                    <p>{/* @wc-context: programming */ _w_runtime_.t(1)}</p>
                    {/* @wc-context: door */}
                    <p>{_w_runtime_.t(2)}</p>
                    {/* @wc-context: distance */}
                    <p>{_w_runtime_.t(3)}</p>
                </>
            }`, `
        msgid ""
        msgstr ""

        #: test-tmp/test.jsx
        msgctxt "music"
        msgid "String"
        msgstr "String"

        #: test-tmp/test.jsx
        msgctxt "programming"
        msgid "String"
        msgstr "String"

        #: test-tmp/test.jsx
        msgctxt "door"
        msgid "Close"
        msgstr "Close"

        #: test-tmp/test.jsx
        msgctxt "distance"
        msgid "Close"
        msgstr "Close"
    `, [ 'String', 'String', 'Close', 'Close',  ])
})

test('Plural', async function(t) {
    await testContent(t,
        tsx`
            function m() {
                return <p>{plural(items, ['One item', '# items'])}</p>
            }`,
        tsx`
            import _w_to_rt_ from 'wuchale/runtime'
            import _w_load_rx_,{get as _w_load_} from "../tests/test-tmp/loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"

            function m() {
                const _w_runtime_ = _w_to_rt_(_w_load_('jsx'))
                return <p>{plural(items, _w_runtime_.tp(0), _w_runtime_._.p)}</p>
            }
    `, `
    msgid ""
    msgstr ""

    #: test-tmp/test.jsx
    msgid "One item"
    msgid_plural "# items"
    msgstr[0] "One item"
    msgstr[1] "# items"
    `, [ [ 'One item', '# items' ] ])
})

test('Nested and mixed', async function(t) {
    await testContent(t,
        tsx`
            function m() {
                return <>
                    <p>Hello and <b>welcome</b> to <i>the app</i>!</p>
                    <p>{num} messages</p>
                </>
            }`,
        tsx`
            import _w_to_rt_ from 'wuchale/runtime'
            import _w_load_rx_,{get as _w_load_} from "../tests/test-tmp/loader.js"
            import W_tx_ from "@wuchale/jsx/runtime.jsx"

            function m() {
                const _w_runtime_ = _w_to_rt_(_w_load_('jsx'))
                return <>
                    <p><W_tx_ t={[_w_ctx_ => <b key="_0">{_w_runtime_.tx(_w_ctx_)}</b>, _w_ctx_ => <i key="_1">{_w_runtime_.tx(_w_ctx_)}</i>]} x={_w_runtime_.cx(0)} /></p>
                    <p><W_tx_ x={_w_runtime_.cx(1)} a={[num]} /></p>
                </>
            }
    `, `
    msgid ""
    msgstr ""

    #: test-tmp/test.jsx
    msgid "Hello and <0>welcome</0> to <1>the app</1>!"
    msgstr "Hello and <0>welcome</0> to <1>the app</1>!"

    #. placeholder {0}: num
    #: test-tmp/test.jsx
    msgid "{0} messages"
    msgstr "{0} messages"
    `, [ ['Hello and ', [0, 'welcome'], ' to ', [1, 'the app'], '!'], [0, ' messages'] ])
})
