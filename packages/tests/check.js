// $$ node %f
import { AdapterHandler } from 'wuchale/handler'
import { IndexTracker } from 'wuchale/adapter'
import { defaultConfig } from 'wuchale/config'
import { adapter } from '@wuchale/svelte'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { readFile } from 'fs/promises'
import PO from 'pofile'

/**
 * @param {string} content
 */
export async function getOutput(content) {
    const handler = new AdapterHandler(
        adapter(),
        'svelte',
        defaultConfig,
        new IndexTracker(),
        'test',
        process.cwd(),
    )
    await handler.init()
    const { code } = await handler.transform(content, 'src/test.svelte')
    const { translations, compiled } = handler
    return { code, translations, compiled }
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * @param {string} str
 */
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

/**
 * @param {any} t
 * @param {string} content
 * @param {string} expectedContent
 * @param {string} expectedTranslations
 * @param {string[] | string[][]} expectedCompiled
 */
export async function testContent(t, content, expectedContent, expectedTranslations, expectedCompiled) {
    const { code, translations, compiled } = await getOutput(content)
    t.assert.strictEqual(trimLines(code), trimLines(expectedContent))
    const po = new PO()
    for (const key in translations.en) {
        po.items.push(translations.en[key])
    }
    t.assert.strictEqual(trimLines(po.toString()), trimLines(expectedTranslations))
    t.assert.deepEqual(compiled.en, expectedCompiled)
}

/**
 * @param {any} t
 * @param {string} testDir
 */
export async function testDir(t, testDir) {
    const dir = `${__dirname}/${testDir}`
    const content = (await readFile(`${dir}/app.svelte`)).toString()
    const contentOut = (await readFile(`${dir}/app.out.svelte`)).toString()
    const poContents = (await readFile(`${dir}/en.po`)).toString()
    const compiledContents = JSON.parse((await readFile(`${dir}/en.json`)).toString())
    await testContent(t, content, contentOut, poContents, compiledContents)
}

// only for syntax highlighting
export const svelte = (/** @type {TemplateStringsArray} */ foo) => foo.join('')

// const p = await getOutput(svelte`
// <i>Hola</i>
// <p>{plural(2, ['one', 'two', 'three'],)}</p>
// `)
// console.log(p.code)
// console.log(Object.values(p.translations.en))
