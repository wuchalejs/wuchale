// $$ cd .. && npm run test
// @ts-nocheck

import { test } from 'node:test'
import setupPreprocess from '../preprocess/index.js'
import { parse } from 'svelte/compiler'
import { readFile } from 'fs/promises'

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
    const plugin = await setupPreprocess(options)
    const { preprocess, translations, compiled } = plugin.setupTesting()
    const ast = parse(content, {modern: true})
    const processed = await preprocess(content, ast, 'test.svelte')
    return { processed, translations, compiled }
}

async function testContent(t, content, expectedContent, expectedTranslations, expectedCompiled) {
    const { processed, translations, compiled } = await getOutput(content)
    t.assert.strictEqual(trimLines(processed.code), trimLines(expectedContent))
    const tObj = {}
    for (const key in translations.en) {
        tObj[key] = translations.en[key].msgstr[0]
    }
    t.assert.deepEqual(tObj, expectedTranslations)
    t.assert.deepEqual(compiled.en, expectedCompiled)
}

test('Simple text', async function(t) {
    await testContent(t, 'Hello', svelte`
        <script>import WuchaleTrans, {wuchaleTrans} from "wuchale/runtime.svelte"
        </script>
        {wuchaleTrans(0)}
    `, { Hello: 'Hello' }, ['Hello'])
})

test('Simple element', async function(t) {
    await testContent(t, '<p>Hello</p>', svelte`
        <script>import WuchaleTrans, {wuchaleTrans} from "wuchale/runtime.svelte"
        </script>
        <p>{wuchaleTrans(0, )}</p>
    `, { Hello: 'Hello' }, ['Hello'])
})

test('Lower case string in expression tag', async function(t) { // small letter beginning inside string
    await testContent(t, `<p>{'hello there'}</p>`, undefined, {}, [])
})

test('Multiple in one file', async function(t) {
    await testContent(t, svelte`
        <h1>Title</h1>
        <p>{'Welcome to the app'}</p>
        <p>Hello <b>{userName}</b></p>
    `, svelte`
         <script>import WuchaleTrans, {wuchaleTrans} from "wuchale/runtime.svelte"
         </script>
         <h1>{wuchaleTrans(0, )}</h1>
         <p>{wuchaleTrans(1)}</p>
         <p>
             {#snippet wuchaleSnippet0(ctx)}
                 <b>userName</b>
             {/snippet}
             <WuchaleTrans tags={[wuchaleSnippet0]} id={2} />
         </p>
    `, {
        'Hello <0>{0}</0>': 'Hello <0>{0}</0>',
        'Welcome to the app': 'Welcome to the app',
        Title: 'Title'
    }, [
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
    const poContents = JSON.parse((await readFile('tests/complicated/po.json')).toString())
    const compiledContents = JSON.parse((await readFile('tests/complicated/en.json')).toString())
    await testContent(t, content, contentOut, poContents, compiledContents)
})
