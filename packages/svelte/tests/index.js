// $$ cd .. && npm run test

import { test } from 'node:test'
import { testContent, testDir, svelte, javascript } from './check.js'
import { adapter } from '@wuchale/svelte'
import { statfs } from 'fs/promises'

test('Default loader file paths', async function(t){
    const adap = adapter()
    for (const loader of ['reactive', 'vanilla', 'sveltekit', 'bundle']) {
        await statfs(adap.defaultLoaderPath(loader)) // no error
    }
})

test('Simple text', async function(t) {
    await testContent(t, 'Hello', svelte`
        <script>
            import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
            import _w_to_rt_ from 'wuchale/runtime'
            import {get as _w_load_},_w_load_rx_ from "../tests/test-tmp/loader.svelte.js"
            const _w_runtime_ = $derived(_w_to_rt_(_w_load_rx_('svelte')))
        </script>
        {_w_runtime_.t(0)}
    `, `
    msgid ""
    msgstr ""

    #: test-tmp/test.svelte
    msgid "Hello"
    msgstr "Hello"
    `, ['Hello'])
})

test('JS module files', async function(t) {
    await testContent(t, javascript`
        'Not translation!' // simple expression
        const varName = 'No extraction' // simple assignment
        const noExtract = call('Foo')
        noExtract('Foo')
        const msg = $derived('Hello')

        function foo() {
            return 'Should extract'
        }

    `, javascript`
        import _w_to_rt_ from 'wuchale/runtime'
        import {get as _w_load_},_w_load_rx_ from "./tests/test-tmp/loader.svelte.js"
        const _w_runtime_ = $derived(_w_to_rt_(_w_load_rx_('svelte')))

        'Not translation!' // simple expression
        const varName = 'No extraction' // simple assignment
        const noExtract = call('Foo')
        noExtract('Foo')
        const msg = $derived(_w_runtime_.t(0))

        function foo() {
            const _w_runtime_ = _w_to_rt_(_w_load_('svelte'))
            return _w_runtime_.t(1)
        }
    `, `
        msgid ""
        msgstr ""

        #: test.svelte.js
        msgid "Hello"
        msgstr "Hello"

        #: test.svelte.js
        msgid "Should extract"
        msgstr "Should extract"
    `, ['Hello', 'Should extract'], 'test.svelte.js')
})

test('Simple element with new lines', async function(t) {
    await testContent(t, svelte`
        <p title={loggedIn && 'Hello'}>
            Hello
            There
        </p>`,
    svelte`
        <script>
            import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
            import _w_to_rt_ from 'wuchale/runtime'
            import {get as _w_load_},_w_load_rx_ from "../tests/test-tmp/loader.svelte.js"
            const _w_runtime_ = $derived(_w_to_rt_(_w_load_rx_('svelte')))
        </script>
        <p title={loggedIn && _w_runtime_.t(0)}>
            {_w_runtime_.t(1)}
        </p>
    `, `
        msgid ""
        msgstr ""

        #: test-tmp/test.svelte
        msgid "Hello"
        msgstr "Hello"

        #: test-tmp/test.svelte
        msgid ""
        "Hello\\n"
        "There"
        msgstr ""
        "Hello\\n"
        "There"
    `, ['Hello', 'Hello\nThere'])
})

test('Ignore and include', async function(t) {
    await testContent(t, svelte`
        <div>
            <svg><path d="M100 200" /></svg>
            <p>{'hello there'}</p>
            <!-- @wc-ignore -->
            <span>Ignore this</span>
            <!-- @wc-include -->
            {'include this'}
        </div>
    `, svelte`
        <script>
            import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
            import _w_to_rt_ from 'wuchale/runtime'
            import {get as _w_load_},_w_load_rx_ from "../tests/test-tmp/loader.svelte.js"
            const _w_runtime_ = $derived(_w_to_rt_(_w_load_rx_('svelte')))
        </script>
        <div>
            <svg><path d="M100 200" /></svg>
            <p>{'hello there'}</p>
            <!-- @wc-ignore -->
            <span>Ignore this</span>
            <!-- @wc-include -->
            {_w_runtime_.t(0)}
        </div>
    `, `
    msgid ""
    msgstr ""

    #: test-tmp/test.svelte
    msgid "include this"
    msgstr "include this"
    `, ['include this'])
})

test('Context', async function(t) {
    await testContent(t,
        svelte`
            <p>{/* @wc-context: music */ 'String'}</p>
            <p>{/* @wc-context: programming */ 'String'}</p>
            <!-- @wc-context: door -->
            <p>Close</p>
            <!-- @wc-context: distance -->
            <p>Close</p>
        `,
        svelte`
            <script>
                import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
                import _w_to_rt_ from 'wuchale/runtime'
                import {get as _w_load_},_w_load_rx_ from "../tests/test-tmp/loader.svelte.js"
                const _w_runtime_ = $derived(_w_to_rt_(_w_load_rx_('svelte')))
            </script>
            <p>{/* @wc-context: music */ _w_runtime_.t(0)}</p>
            <p>{/* @wc-context: programming */ _w_runtime_.t(1)}</p>
            <!-- @wc-context: door -->
            <p>{_w_runtime_.t(2)}</p>
            <!-- @wc-context: distance -->
            <p>{_w_runtime_.t(3)}</p>
    `, `
        msgid ""
        msgstr ""

        #: test-tmp/test.svelte
        msgctxt "music"
        msgid "String"
        msgstr "String"

        #: test-tmp/test.svelte
        msgctxt "programming"
        msgid "String"
        msgstr "String"

        #: test-tmp/test.svelte
        msgctxt "door"
        msgid "Close"
        msgstr "Close"

        #: test-tmp/test.svelte
        msgctxt "distance"
        msgid "Close"
        msgstr "Close"
    `, [ 'String', 'String', 'Close', 'Close',  ])
})

test('Plural', async function(t) {
    await testContent(t,
        svelte`<p>{plural(items, ['One item', '# items'])}</p>`,
        svelte`
            <script>
                import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
                import _w_to_rt_ from 'wuchale/runtime'
                import {get as _w_load_},_w_load_rx_ from "../tests/test-tmp/loader.svelte.js"
                const _w_runtime_ = $derived(_w_to_rt_(_w_load_rx_('svelte')))
            </script>
            <p>{plural(items, _w_runtime_.tp(0), _w_runtime_._.p)}</p>
    `, `
    msgid ""
    msgstr ""

    #: test-tmp/test.svelte
    msgid "One item"
    msgid_plural "# items"
    msgstr[0] "One item"
    msgstr[1] "# items"
    `, [ [ 'One item', '# items' ] ])
})

test('Multiple in one file', async t => await testDir(t, 'multiple'))

test('Complicated', async t => await testDir(t, 'complicated'))
