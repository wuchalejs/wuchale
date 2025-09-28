// $$ node %f
import { AdapterHandler, defaultConfig, Logger } from 'wuchale'
import { adapter } from 'wuchale/adapter-vanilla'
import { readFile, rm } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, relative } from 'path'
import PO from 'pofile'

export const absDir = (/** @type {string} */ fileurl) => dirname(fileURLToPath(fileurl))
const dirBase = absDir(import.meta.url)
const testFile = relative(dirBase, `${dirBase}/test-tmp/test.js`)

export const adapterOpts = {
    files: `${dirBase}/test-tmp/*`,
    catalog: `${dirBase}/test-tmp/{locale}`,
    initInsideFunc: false,
}

/**
 * @param {string} content
 * @param {import("wuchale").Adapter} adapter
 * @param {string} key
 * @param {string} filename
 * @param {number} hmrVersion
 * @returns {Promise<object>}
 */
export async function getOutput(adapter, key, content, filename, hmrVersion) {
    adapter.catalog
    const handler = new AdapterHandler(
        adapter,
        key,
        defaultConfig,
        'prod',
        'virtual',
        process.cwd(),
        new Logger('error'),
    )
    await handler.init({})
    const { code } = await handler.transform(content, filename, hmrVersion)
    const { poFilesByLoc, compiled } = handler.sharedState
    return { code, catalogs: poFilesByLoc, compiled }
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
 * @param {(string | (string | number | (string | number)[])[])[]} expectedCompiled
 * @param {string} testFile
 * @param {import("wuchale").Adapter} adapter
 * @param {string} key
 * @param {number} hmrVersion
 */
export async function testContentSetup(t, adapter, key, content, expectedContent, expectedTranslations, expectedCompiled, testFile, hmrVersion=-1) {
    const { code, catalogs, compiled } = await getOutput(adapter, key, content, testFile, hmrVersion)
    t.assert.strictEqual(trimLines(code), trimLines(expectedContent))
    const po = new PO()
    for (const key in catalogs.en.catalog) {
        po.items.push(catalogs.en.catalog[key])
    }
    t.assert.strictEqual(trimLines(po.toString()), trimLines(expectedTranslations))
    t.assert.deepEqual(compiled.en?.items ?? [], expectedCompiled)
}

/**
 * @param {any} t
 * @param {string} dir
 * @param {import("wuchale").Adapter} adapter
 * @param {string} key
 * @param {string} testFile
 * @param {string} testFileOut
 */
export async function testDirSetup(t, adapter, key, dir, testFile, testFileOut) {
    const content = (await readFile(`${dir}/${testFile}`)).toString()
    const contentOut = (await readFile(`${dir}/${testFileOut}`)).toString()
    const poContents = (await readFile(`${dir}/en.po`)).toString()
    const compiledContents = JSON.parse((await readFile(`${dir}/en.json`)).toString())
    await testContentSetup(t, adapter, key, content, contentOut, poContents, compiledContents, testFile, -1)
}

export const basic = adapter(adapterOpts)

/**
 * @param {any} t
 * @param {string} content
 * @param {string} expectedContent
 * @param {string} expectedTranslations
 * @param {(string | (string | number | (string | number)[])[])[]} expectedCompiled
 */
export async function testContent(t, content, expectedContent, expectedTranslations, expectedCompiled, adapter=basic, hmrVersion=-1) {
    try {
        await rm(adapterOpts.catalog.replace('{locale}', 'en.po'))
    } catch {}
    await testContentSetup(t, adapter, 'main', content, expectedContent, expectedTranslations, expectedCompiled, testFile, hmrVersion)
}

/**
 * @param {any} t
 * @param {string} dir
 */
export async function testDir(t, dir, adapter=basic) {
    try {
        await rm(adapterOpts.catalog.replace('{locale}', 'en.po'))
    } catch {}
    await testDirSetup(t, adapter, 'basic',`${dirBase}/${dir}`, 'app.js', 'app.out.js')
}

// only for syntax highlighting
export const typescript = (/** @type {TemplateStringsArray} */ foo) => foo.join('')
export const javascript = typescript

// const code = typescript`
//     const t = {
//         f: () => 'Hello',
//         g: function() {
//             return 'Hello'
//         },
//     }
// `
// const p = await getOutput(basic, 'basic', code, testFile, -1)
// console.log(p.code)
// console.log(Object.values(p.catalogs.en))
// console.log(p.compiled.en)
