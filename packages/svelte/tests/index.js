// $$ cd .. && npm run test

import { test } from 'node:test'
import { testContent, testDir, svelte } from './check.js'

test('Simple text', async function(t) {
    await testContent(t, 'Hello', svelte`
        <script>
            import { _wrs_ } from "@wuchale/svelte/runtime.svelte.js"
            import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
            const wuchaleRuntime = $derived(_wrs_("svelte"))
        </script>
        {wuchaleRuntime.t(0)}
    `, `
    msgid ""
    msgstr ""

    #: src/test.svelte
    msgid "Hello"
    msgstr "Hello"
    `, ['Hello'])
})

test('Simple element with new lines', async function(t) {
    await testContent(t, svelte`
        <p>
            Hello
            There
        </p>`,
    svelte`
        <script>
            import { _wrs_ } from "@wuchale/svelte/runtime.svelte.js"
            import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
            const wuchaleRuntime = $derived(_wrs_("svelte"))
        </script>
        <p>
            {wuchaleRuntime.t(0)}
        </p>
    `, `
        msgid ""
        msgstr ""

        #: src/test.svelte
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
            import { _wrs_ } from "@wuchale/svelte/runtime.svelte.js"
            import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
            const wuchaleRuntime = $derived(_wrs_("svelte"))
        </script>
        <div>
            <svg><path d="M100 200" /></svg>
            <p>{'hello there'}</p>
            <!-- @wc-ignore -->
            <span>Ignore this</span>
            <!-- @wc-include -->
            {wuchaleRuntime.t(0)}
        </div>
    `, `
    msgid ""
    msgstr ""

    #: src/test.svelte
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
            import { _wrs_ } from "@wuchale/svelte/runtime.svelte.js"
                import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
                const wuchaleRuntime = $derived(_wrs_("svelte"))
            </script>
            <p>{/* @wc-context: music */ wuchaleRuntime.t(0)}</p>
            <p>{/* @wc-context: programming */ wuchaleRuntime.t(1)}</p>
            <!-- @wc-context: door -->
            <p>{wuchaleRuntime.t(2)}</p>
            <!-- @wc-context: distance -->
            <p>{wuchaleRuntime.t(3)}</p>
    `, `
        msgid ""
        msgstr ""

        #: src/test.svelte
        msgctxt "music"
        msgid "String"
        msgstr "String"

        #: src/test.svelte
        msgctxt "programming"
        msgid "String"
        msgstr "String"

        #: src/test.svelte
        msgctxt "door"
        msgid "Close"
        msgstr "Close"

        #: src/test.svelte
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
                import { _wrs_ } from "@wuchale/svelte/runtime.svelte.js"
                import WuchaleTrans from "@wuchale/svelte/runtime.svelte"
                const wuchaleRuntime = $derived(_wrs_("svelte"))
            </script>
            <p>{plural(items, wuchaleRuntime.tp(0), wuchaleRuntime.plr())}</p>
    `, `
    msgid ""
    msgstr ""

    #: src/test.svelte
    msgid "One item"
    msgid_plural "# items"
    msgstr[0] "One item"
    msgstr[1] "# items"
    `, [ [ 'One item', '# items' ] ])
})

test('Multiple in one file', async t => await testDir(t, 'multiple'))

test('Complicated', async t => await testDir(t, 'complicated'))
