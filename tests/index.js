// $$ cd .. && npm run test
// @ts-nocheck

import { test } from 'node:test'
import { parse } from 'svelte/compiler'
import { readFile } from 'fs/promises'
import compileTranslation from '../dist/plugin/compile.js'
import PO from 'pofile'
import { getOutput, svelte } from './check.js'

function trimLines(str) {
    if (!str) {
        return
    }
    let result = []
    for (const line of str.split('\n')) {
        if (line.trim()) {
            result.push(line.trim())
        }
    }
    return result.join('\n')
}

async function testContent(t, content, expectedContent, expectedTranslations, expectedCompiled) {
    const { processed, translations, compiled } = await getOutput(content)
    t.assert.strictEqual(trimLines(processed.code), trimLines(expectedContent))
    const po = new PO()
    for (const key in translations.en) {
        po.items.push(translations.en[key])
    }
    t.assert.strictEqual(trimLines(po.toString()), trimLines(expectedTranslations))
    t.assert.deepEqual(compiled.en, expectedCompiled)
}

test('Compile nested', function(t) {
    t.assert.deepEqual(compileTranslation('Foo <0>bar</0>', 'foo'), ['Foo ', [0, 'bar']])
    t.assert.deepEqual(compileTranslation('Foo <0>bar {0}</0>', 'foo'), ['Foo ', [0, 'bar ', 0]])
    t.assert.deepEqual(compileTranslation('Foo <0>bar {0}<0/></0>', 'foo'), ['Foo ', [0, 'bar ', 0, [0]]])
    t.assert.deepEqual(
        compileTranslation('foo <0>bold <form>ignored <0/> {0} <1>nest {0}</1></0> <1/> bar', 'foo'),
        ['foo ', [ 0, 'bold <form>ignored ', [ 0 ], ' ', 0, ' ', [ 1, 'nest ', 0 ] ], ' ', [ 1 ], ' bar'],
    )
})

test('Simple text', async function(t) {
    await testContent(t, 'Hello', svelte`
        <script>
            import {wuchaleTrans, wuchaleTransCtx, wuchaleTransPlural, wuchalePluralsRule} from "wuchale/runtime.svelte.js"
            import WuchaleTrans from "wuchale/runtime.svelte"
        </script>
        {wuchaleTrans(0)}
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
            import {wuchaleTrans, wuchaleTransCtx, wuchaleTransPlural, wuchalePluralsRule} from "wuchale/runtime.svelte.js"
            import WuchaleTrans from "wuchale/runtime.svelte"
        </script>
        <p>{wuchaleTrans(0)}</p>
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
            import {wuchaleTrans, wuchaleTransCtx, wuchaleTransPlural, wuchalePluralsRule} from "wuchale/runtime.svelte.js"
            import WuchaleTrans from "wuchale/runtime.svelte"
        </script>
        <div>
            <svg><path d="M100 200" /></svg>
            <p>{'hello there'}</p>
            <!-- @wc-ignore -->
            <span>Ignore this</span>
            <!-- @wc-include -->
            {wuchaleTrans(0)}
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
                import {wuchaleTrans, wuchaleTransCtx, wuchaleTransPlural, wuchalePluralsRule} from "wuchale/runtime.svelte.js"
                import WuchaleTrans from "wuchale/runtime.svelte"
            </script>
            <p>{/* @wc-context: music */ wuchaleTrans(0)}</p>
            <p>{/* @wc-context: programming */ wuchaleTrans(1)}</p>
            <!-- @wc-context: door -->
            <p>{wuchaleTrans(2)}</p>
            <!-- @wc-context: distance -->
            <p>{wuchaleTrans(3)}</p>
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
                import {wuchaleTrans, wuchaleTransCtx, wuchaleTransPlural, wuchalePluralsRule} from "wuchale/runtime.svelte.js"
                import WuchaleTrans from "wuchale/runtime.svelte"
            </script>
            <p>{plural(items, wuchaleTransPlural(0), wuchalePluralsRule())}</p>
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

async function testDir(t, dir) {
    const content = (await readFile(`tests/${dir}/app.svelte`)).toString()
    const contentOut = (await readFile(`tests/${dir}/app.out.svelte`)).toString()
    const poContents = (await readFile(`tests/${dir}/en.po`)).toString()
    const compiledContents = JSON.parse((await readFile(`tests/${dir}/en.json`)).toString())
    await testContent(t, content, contentOut, poContents, compiledContents)
}

test('Multiple in one file', async t => await testDir(t, 'multiple'))

test('Complicated', async t => await testDir(t, 'complicated'))
