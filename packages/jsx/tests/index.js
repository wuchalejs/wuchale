// $$ cd .. && npm run test

import { test } from 'node:test'
import { testContent, testDir, jsx } from './check.js'
import { adapter } from '@wuchale/jsx'
import { statfs } from 'fs/promises'

test('Default loader file paths', async function(t){
    const adap = adapter()
    for (const loader of ['default', 'react', 'react.bundle', 'solidjs', 'solidjs.bundle']) {
        await statfs(adap.defaultLoaderPath(loader)) // no error
    }
})

test('Simple text', async function(t) {
    await testContent(t, jsx`
        function m() {
            return <p>Hello</p>
        }
    `, jsx`
        import WuchaleTrans from "@wuchale/jsx/runtime.jsx"
        import _w_to_rt_ from 'wuchale/runtime'
        import _w_load_ from "../tests/test-tmp/loader.js"
        function m() {
            const _w_runtime_ = _w_to_rt_(_w_load_('jsx'))
            return <p>{_w_runtime_.t(0)}</p>
        }
    `, `
    msgid ""
    msgstr ""
    #: test-tmp/test.jsx
    msgid "Hello"
    msgstr "Hello"
    `, ['Hello'])
})

test('Ignore and include', async function(t) {
    await testContent(t, jsx`
        function foo() {
            return <div>
                <svg><path d="M100 200" /></svg>
                <p>{'hello there'}</p>
                {/* wuchale-ignore */}
                <span>Ignore this</span>
                {/* wuchale-include */}
                {'include this'}
            </div>
        }
    `, jsx`
        import WuchaleTrans from "@wuchale/jsx/runtime.jsx"
        import _w_to_rt_ from 'wuchale/runtime'
        import _w_load_ from "../tests/test-tmp/loader.js"
        function foo() {
            const _w_runtime_ = _w_to_rt_(_w_load_('jsx'))
            return <div>
                <svg><path d="M100 200" /></svg>
                <p>{'hello there'}</p>
                {/* wuchale-ignore */}
                <span>Ignore this</span>
                {/* wuchale-include */}
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
                <p>{/* wuchale-context: music */ 'String'}</p>
                <p>{/* wuchale-context: programming */ 'String'}</p>
                {/* wuchale-context: door */}
                <p>Close</p>
                {/* wuchale-context: distance */}
                <p>Close</p>
            </>
        }`, jsx`
            import WuchaleTrans from "@wuchale/jsx/runtime.jsx"
            import _w_to_rt_ from 'wuchale/runtime'
            import _w_load_ from "../tests/test-tmp/loader.js"
            const m = () => {
                const _w_runtime_ = _w_to_rt_(_w_load_('jsx'))
                return <>
                    <p>{/* wuchale-context: music */ _w_runtime_.t(0)}</p>
                    <p>{/* wuchale-context: programming */ _w_runtime_.t(1)}</p>
                    {/* wuchale-context: door */}
                    <p>{_w_runtime_.t(2)}</p>
                    {/* wuchale-context: distance */}
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
            import _w_load_ from "../tests/test-tmp/loader.js"
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
