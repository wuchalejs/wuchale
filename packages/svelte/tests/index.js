// $$ cd .. && npm run test

import { test } from 'node:test'
import { testContent, testDir, svelte } from './check.js'
import { javascript } from '../../wuchale/tests/check.js'

test('Simple text', async function(t) {
    await testContent(t, 'Hello', svelte`
        <script>
            import _w_load_ from "../tests/test-tmp/loader.svelte.js"
            import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
            const _w_runtime_ = $derived(_w_load_('svelte'))
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

test('JS no extract', async function(t) {
    await testContent(t, javascript`
        // 'Not translation!' // simple expression
        // const varName = 'No extraction' // simple assignment
        const noExtract = call('Foo')
        noExtract('Foo')
    `, undefined, `
        msgid ""
        msgstr ""
    `, [], 'test.svelte.js')
})

test('Simple element with new lines', async function(t) {
    await testContent(t, svelte`
        <p>
            Hello
            There
        </p>`,
    svelte`
        <script>
            import _w_load_ from "../tests/test-tmp/loader.svelte.js"
            import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
            const _w_runtime_ = $derived(_w_load_('svelte'))
        </script>
        <p>
            {_w_runtime_.t(0)}
        </p>
    `, `
        msgid ""
        msgstr ""

        #: test-tmp/test.svelte
        msgid ""
        "Hello\\n"
        "            There"
        msgstr ""
        "Hello\\n"
        "            There"
    `, ['Hello\n            There'])
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
            import _w_load_ from "../tests/test-tmp/loader.svelte.js"
            import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
            const _w_runtime_ = $derived(_w_load_('svelte'))
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
            import _w_load_ from "../tests/test-tmp/loader.svelte.js"
                import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
                const _w_runtime_ = $derived(_w_load_('svelte'))
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
                import _w_load_ from "../tests/test-tmp/loader.svelte.js"
                import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
                const _w_runtime_ = $derived(_w_load_('svelte'))
            </script>
            <p>{plural(items, _w_runtime_.tp(0), _w_runtime_.plr())}</p>
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
