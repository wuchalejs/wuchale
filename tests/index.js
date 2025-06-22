// $$ cd .. && npm run test
// @ts-nocheck

import { test } from 'node:test'
import plugin from '../dist/plugin/index.js'
import { parse } from 'svelte/compiler'
import { readFile } from 'fs/promises'
import compileTranslation from '../dist/plugin/compile.js'
import PO from 'pofile'

const options = { otherLocales: [], geminiAPIKey: null }

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
    const plug = await plugin(options)
    await plug.configResolved({env: {PROD: null}, root: ''})
    const { translations, compiled } = plug.setupTesting()
    const processed = await plug.transform.handler(content, 'test.svelte')
    plug.buildEnd()
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
            import {wuchaleTrans} from "wuchale/runtime.svelte.js"
            import WuchaleTrans from "wuchale/runtime.svelte"
        </script>
        {wuchaleTrans(0)}
    `, `
    msgid ""
    msgstr ""

    #: test.svelte
    msgid "Hello"
    msgstr "Hello"
    `, ['Hello'])
})

test('Simple element', async function(t) {
    await testContent(t, '<p>Hello</p>', svelte`
        <script>
            import {wuchaleTrans} from "wuchale/runtime.svelte.js"
            import WuchaleTrans from "wuchale/runtime.svelte"
        </script>
        <p>{wuchaleTrans(0)}</p>
    `, `
    msgid ""
    msgstr ""

    #: test.svelte
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
        <p>Hello <b>{userName}</b></p>
    `, svelte`
         <script>
            import {wuchaleTrans} from "wuchale/runtime.svelte.js"
            import WuchaleTrans from "wuchale/runtime.svelte"
         </script>
         <h1>{wuchaleTrans(0)}</h1>
         <p>{wuchaleTrans(1)}</p>
         <p>
             {#snippet wuchaleSnippet0(ctx)}
                 <b>userName</b>
             {/snippet}
             <WuchaleTrans tags={[wuchaleSnippet0]} id={2} />
         </p>
    `, `
        msgid ""
        msgstr ""

        #: test.svelte
        msgid "Title"
        msgstr "Title"

        #: test.svelte
        msgid "Welcome to the app"
        msgstr "Welcome to the app"

        #: test.svelte
        msgid "Hello <0>{0}</0>"
        msgstr "Hello <0>{0}</0>"`,
    [
        'Title',
        'Welcome to the app',
        [
            'Hello ',
            [
                0,
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
