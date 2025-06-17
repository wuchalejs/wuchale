// $$ cd .. && npm run test
// @ts-nocheck

import { test } from 'node:test'
import setupPreprocess from '../preprocess/index.js'
import { parse } from 'svelte/compiler'

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
    const ast = parse(content)
    ast.type = 'SvelteComponent'
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

test('Lower case string in mustache', async function(t) { // small letter beginning inside string
    await testContent(t, `<p>{'hello there'}</p>`, undefined, {}, [])
})

test('Multiple in one file', async function(t) {
    await testContent(t, svelte`
        <h1>Title</h1>
        <p>{'Welcome to the app'}</p>
        <button>{'Logout'}</button>
    `, svelte`
         <script>import WuchaleTrans, {wuchaleTrans} from "wuchale/runtime.svelte"
         </script>
         <h1>{wuchaleTrans(0, )}</h1>
         <p>{wuchaleTrans(1)}</p>
         <button>{wuchaleTrans(2)}</button>
    `, {
        Title: 'Title',
        ['Welcome to the app']: 'Welcome to the app',
        Logout: 'Logout',
    }, ['Title', 'Welcome to the app', 'Logout'])
})

test('Complicated', async function(t) {
    await testContent(t, svelte`
        <p>
            This is a very {obj.property['non-extracted text']['Extracted text']}
            Complicated <i class="not-extracted" title="Extracted">and even <b><u>depply</u> nested {\`with \$\{someJSEven\}\` + 'foo'}</b> content</i>
            With
            {#if someFunction('Extracted Text', normalParam, ['+etracted anyway'])}
                Conditionals,
                {#each collection.members as member}
                    Loops and {member}
                    {#await fetch('https://jsonplaceholder.typicode.com/todos/1') then res}
                        {#await res.json() then json}
                            <b>{json.title} other blocks</b>
                        {/await}
                    {/await}
                    Supported
                {/each}
            {/if}
        </p>
        - But ignore me
    `, svelte`
      <script>import WuchaleTrans, {wuchaleTrans} from "wuchale/runtime.svelte"
      </script>
      <p>
          {#snippet wuchaleSnippet0(ctx)}
              <i class="not-extracted" title={wuchaleTrans(1)}>
                  {#snippet wuchaleSnippet0(ctx)}
                      <b>
                          {#snippet wuchaleSnippet0(ctx)}
                              <u>{ctx[1]}</u>
                          {/snippet}
                          <WuchaleTrans tags={[wuchaleSnippet0]} ctx={ctx} args={[\`with \$\{someJSEven\}\` + 'foo']} />
                      </b>
                  {/snippet}
                  <WuchaleTrans tags={[wuchaleSnippet0]} ctx={ctx} />
              </i>
          {/snippet}
          {#snippet wuchaleSnippet1(ctx)}
              {#if someFunction(wuchaleTrans(2), normalParam, [wuchaleTrans(3)])}{wuchaleTrans(4)}{#each collection.members as member}{wuchaleTrans(5)}{member}
                  {#await fetch('https://jsonplaceholder.typicode.com/todos/1') then res}
                      {#await res.json() then json}
                          <b>{wuchaleTrans(6, json.title)}</b>
                      {/await}
                  {/await}{wuchaleTrans(7)}{/each}
              {/if}
          {/snippet}
          <WuchaleTrans tags={[wuchaleSnippet0, wuchaleSnippet1]} id={8} args={[obj.property['non-extracted text'][wuchaleTrans(0)]]} />
      </p>But ignore me
    `, {
        'Conditionals,': 'Conditionals,',
        'Extracted Text': 'Extracted Text',
        'Extracted text': 'Extracted text',
        'Loops and': 'Loops and',
        'This is a very {0} Complicated <0>and even <0><0>depply</0> nested {0}</0> content</0> With <1/>': 'This is a very {0} Complicated <0>and even <0><0>depply</0> nested {0}</0> content</0> With <1/>',
        'etracted anyway': 'etracted anyway',
        '{0} other blocks': '{0} other blocks',
        Extracted: 'Extracted',
        Supported: 'Supported',
    }, [
        'Extracted text',
        'Extracted',
        'Extracted Text',
        'etracted anyway',
        'Conditionals,',
        'Loops and',
        [
            0,
            ' other blocks'
        ],
        'Supported',
        [
            'This is a very ',
            0,
            ' Complicated ',
            [
                0,
                'and even ',
                [
                    0,
                    [
                        0,
                        'depply'
                    ],
                    ' nested ',
                    0
                ],
                ' content'
            ],
            ' With ',
            [
                1
            ]
        ]
    ]
    )
})
