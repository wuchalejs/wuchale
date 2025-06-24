// $$ cd .. && npm run test
// @ts-nocheck

import { test } from 'node:test'
import plugin from '../dist/plugin/index.js'
import { parse } from 'svelte/compiler'
import { readFile } from 'fs/promises'
import compileTranslation from '../dist/plugin/compile.js'
import PO from 'pofile'

const config = { otherLocales: [], geminiAPIKey: null }

// only for syntax highlighting
const svelte = foo => foo[0]

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

async function getOutput(content) {
    const plug = await plugin(config)
    await plug.configResolved({env: {PROD: null}, root: process.cwd()})
    const { _translations: translations, _compiled: compiled } = plug
    const processed = await plug.transformHandler(content, process.cwd() + '/src/test.svelte')
    return { processed, translations, compiled }
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
})

test('Simple text', async function(t) {
    await testContent(t, 'Hello', svelte`
        <script>
            import {wuchaleTrans, wuchaleTransCtx} from "wuchale/runtime.svelte.js"
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

test('Simple element', async function(t) {
    await testContent(t, '<p>Hello</p>', svelte`
        <script>
            import {wuchaleTrans, wuchaleTransCtx} from "wuchale/runtime.svelte.js"
            import WuchaleTrans from "wuchale/runtime.svelte"
        </script>
        <p>{wuchaleTrans(0)}</p>
    `, `
    msgid ""
    msgstr ""

    #: src/test.svelte
    msgid "Hello"
    msgstr "Hello"
    `, ['Hello'])
})

test('Lower case string in expression tag', async function(t) { // small letter beginning inside string
    await testContent(t, `<p>{'hello there'}</p>`, undefined, `
    msgid ""
    msgstr ""
    `, [])
})

test('Multiple in one file', async function(t) {
    await testContent(t, svelte`
        <h1>Title</h1>
        <p>{'Welcome to the app'}</p>
        <p>Nested <b>non-mixed</b></p>
        <p>Nested <b>mixed with {text}</b></p>
        <p>Nested <b>{expressionOnly}</b></p>
    `, svelte`
        <script>
            import {wuchaleTrans, wuchaleTransCtx} from "wuchale/runtime.svelte.js"
            import WuchaleTrans from "wuchale/runtime.svelte"
        </script>
        <h1>{wuchaleTrans(0)}</h1>
        <p>{wuchaleTrans(1)}</p>
        <p>
            {#snippet wuchaleSnippet0(ctx)}
                <b>{wuchaleTransCtx(ctx)}</b>
            {/snippet}
            <WuchaleTrans tags={[wuchaleSnippet0]} id={2} />
        </p>
        <p>
            {#snippet wuchaleSnippet0(ctx)}
                <b>{wuchaleTransCtx(ctx, [text])}</b>
            {/snippet}
            <WuchaleTrans tags={[wuchaleSnippet0]} id={3} />
        </p>
        <p>
            {#snippet wuchaleSnippet0(ctx)}
                <b>{expressionOnly}</b>
            {/snippet}
            <WuchaleTrans tags={[wuchaleSnippet0]} id={4} />
        </p>
    `, `
        msgid ""
        msgstr ""

        #: src/test.svelte
        msgid "Title"
        msgstr "Title"

        #: src/test.svelte
        msgid "Welcome to the app"
        msgstr "Welcome to the app"

        #: src/test.svelte
        msgid "Nested <0>non-mixed</0>"
        msgstr "Nested <0>non-mixed</0>"

        #: src/test.svelte
        msgid "Nested <0>mixed with {0}</0>"
        msgstr "Nested <0>mixed with {0}</0>"

        #: src/test.svelte
        msgid "Nested <0/>"
        msgstr "Nested <0/>"
    `, [
          'Title',
          'Welcome to the app',
          [
            'Nested ',
            [
              0,
              'non-mixed'
            ]
          ],
          [
            'Nested ',
            [
              0,
              'mixed with ',
              0
            ]
          ],
          [
            'Nested ',
            [
              0
            ]
          ]
    ])
})

test('Complicated', async function(t) {
    const content = (await readFile('tests/complicated/app.svelte')).toString()
    const contentOut = (await readFile('tests/complicated/app.out.svelte')).toString()
    const poContents = (await readFile('tests/complicated/en.po')).toString()
    const compiledContents = JSON.parse((await readFile('tests/complicated/en.json')).toString())
    await testContent(t, content, contentOut, poContents, compiledContents)
})
