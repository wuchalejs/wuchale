// $$ cd .. && npm run test

import { test } from 'node:test'
import { testContent, testDir, jsx, adapterOpts } from './check.js'
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

test('Simple text', async function(t) {
    await testContent(t, jsx`
        function Foo() {
            return <p>Hello</p>
        }
        function m() {
            return <p data-novalue>Hello</p>
        }
    `, jsx`
        import WuchaleTrans from "@wuchale/jsx/runtime.jsx"
        import _w_to_rt_ from 'wuchale/runtime'
        import _w_load_rx_,{get as _w_load_} from "../tests/test-tmp/loader.js"
        function Foo() {
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

test('Simple text SolidJS', async function(t) {
    await testContent(t, jsx`
        function Foo() {
            return <p>Hello</p>
        }
    `, jsx`
        import WuchaleTrans from "@wuchale/jsx/runtime.solid.jsx"
        import _w_to_rt_ from 'wuchale/runtime'
        import _w_load_rx_,{get as _w_load_} from "../tests/test-tmp/loader.js"

        const _w_runtime_ = () => _w_to_rt_(_w_load_rx_('jsx'))

        function Foo() {
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
    await testContent(t, jsx`
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
    `, jsx`
        import WuchaleTrans from "@wuchale/jsx/runtime.jsx"
        import _w_to_rt_ from 'wuchale/runtime'
        import _w_load_rx_,{get as _w_load_} from "../tests/test-tmp/loader.js"
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

test('Context', async function(t) {
    await testContent(t, jsx`
        const m = () => {
            return <>
                <p>{/* @wc-context: music */ 'String'}</p>
                <p>{/* @wc-context: programming */ 'String'}</p>
                {/* @wc-context: door */}
                <p>Close</p>
                {/* @wc-context: distance */}
                <p>Close</p>
            </>
        }`, jsx`
            import WuchaleTrans from "@wuchale/jsx/runtime.jsx"
            import _w_to_rt_ from 'wuchale/runtime'
            import _w_load_rx_,{get as _w_load_} from "../tests/test-tmp/loader.js"
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
        jsx`
            function m() {
                return <p>{plural(items, ['One item', '# items'])}</p>
            }`,
        jsx`
            import WuchaleTrans from "@wuchale/jsx/runtime.jsx"
            import _w_to_rt_ from 'wuchale/runtime'
            import _w_load_rx_,{get as _w_load_} from "../tests/test-tmp/loader.js"
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
