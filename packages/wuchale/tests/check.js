// $$ node %f
import { AdapterHandler } from 'wuchale/handler'
import { defaultConfig } from 'wuchale/config'
import { adapter } from 'wuchale/adapter-vanilla'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import PO from 'pofile'

export const absDir = (/** @type {string} */ fileurl) => dirname(fileURLToPath(fileurl))

/**
 * @param {string} content
 * @param {import("wuchale/adapter").Adapter} adapter
 * @param {string} key
 */
async function getOutput(adapter, key, content, filename = 'src/test.svelte') {
    const handler = new AdapterHandler(
        adapter,
        key,
        defaultConfig,
        'test',
        process.cwd(),
    )
    await handler.init()
    const { code } = await handler.transform(content, filename)
    // @ts-ignore
    const { catalogs, compiled } = handler
    return { code, catalogs: catalogs, compiled }
}

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
 * @param {(string | number | (string | number)[])[]} expectedCompiled
 * @param {import("wuchale/adapter").Adapter} adapter
 * @param {string} key
 */
export async function testContentSetup(t, adapter, key, content, expectedContent, expectedTranslations, expectedCompiled) {
    const { code, catalogs, compiled } = await getOutput(adapter, key, content)
    t.assert.strictEqual(trimLines(code), trimLines(expectedContent))
    const po = new PO()
    for (const key in catalogs.en) {
        po.items.push(catalogs.en[key])
    }
    t.assert.strictEqual(trimLines(po.toString()), trimLines(expectedTranslations))
    t.assert.deepEqual(compiled.en ?? [], expectedCompiled)
}

/**
 * @param {any} t
 * @param {string} dir
 * @param {import("wuchale/adapter").Adapter} adapter
 * @param {string} key
 */
export async function testDirSetup(t, adapter, key, dir) {
    const content = (await readFile(`${dir}/app.svelte`)).toString()
    const contentOut = (await readFile(`${dir}/app.out.svelte`)).toString()
    const poContents = (await readFile(`${dir}/en.po`)).toString()
    const compiledContents = JSON.parse((await readFile(`${dir}/en.json`)).toString())
    await testContentSetup(t, adapter, key, content, contentOut, poContents, compiledContents)
}

const basic = adapter()

/**
 * @param {any} t
 * @param {string} content
 * @param {string} expectedContent
 * @param {string} expectedTranslations
 * @param {(string | number | (string | number)[])[]} expectedCompiled
 */
export async function testContent(t, content, expectedContent, expectedTranslations, expectedCompiled) {
    await testContentSetup(t, basic, 'basic', content, expectedContent, expectedTranslations, expectedCompiled)
}

const dirBase = absDir(import.meta.url)

/**
 * @param {any} t
 * @param {string} dir
 */
export async function testDir(t, dir) {
    await testDirSetup(t, basic, 'basic',`${dirBase}/${dir}`)
}

// only for syntax highlighting
export const typescript = (/** @type {TemplateStringsArray} */ foo) => foo.join('')
export const javascript = typescript

// const code = typescript`
//     const t = 'Hello'
// `
// const p = await getOutput(basic, 'basic', code, 'src/test.ts')
// console.log(p.code)
// console.log(Object.values(p.catalogs.en))
// console.log(p.compiled.en)
