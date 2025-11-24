// $$ node %f
import { AdapterHandler, defaultConfig, Logger, type Adapter, type CompiledElement } from 'wuchale'
import { adapter, type VanillaArgs } from 'wuchale/adapter-vanilla'
import { readFile, rm } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, relative } from 'path'
import PO from 'pofile'

export const absDir = (fileurl: string) => relative(process.cwd(), dirname(fileURLToPath(fileurl))) || '.'
const dirBase = absDir(import.meta.url)
const testFile = `${dirBase}/test-dir/test.js`

export const adapterOpts: VanillaArgs = {
    files: `${dirBase}/test-dir/*`,
    localesDir: `${dirBase}/test-tmp/`,
    loader: 'vite',
}

export async function getOutput(adapter: Adapter, key: string, content: string, filename: string, hmrVersion: number): Promise<{code: any, catalogs: any, compiled: any}> {
    const handler = new AdapterHandler(
        adapter,
        key,
        defaultConfig,
        'dev',
        process.cwd(),
        new Logger('error'),
    )
    await handler.init({})
    await handler.initUrlPatterns()
    const { code } = await handler.transform(content, filename, hmrVersion)
    const { poFilesByLoc, compiled } = handler.sharedState
    return { code, catalogs: poFilesByLoc, compiled }
}

function trimLines(str: string) {
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

export async function testContentSetup(t: any, adapter: import("wuchale").Adapter, key: string, content: string, expectedContent: string, expectedTranslations: string, expectedCompiled: CompiledElement[], testFile: string, hmrVersion: number=-1) {
    const { code, catalogs, compiled } = await getOutput(adapter, key, content, testFile, hmrVersion)
    t.assert.strictEqual(trimLines(code), trimLines(expectedContent))
    const po = new PO()
    for (const key in catalogs.en.catalog) {
        po.items.push(catalogs.en.catalog[key])
    }
    t.assert.strictEqual(trimLines(po.toString()), trimLines(expectedTranslations))
    t.assert.deepEqual(compiled.en?.items ?? [], expectedCompiled)
}

export async function testDirSetup(t: any, adapter: import("wuchale").Adapter, key: string, dir: string, testFile: string, testFileOut: string) {
    const fnameIn = `${dir}/${testFile}`
    const content = (await readFile(fnameIn)).toString()
    const contentOut = (await readFile(`${dir}/${testFileOut}`)).toString()
    const poContents = (await readFile(`${dir}/en.po`)).toString()
    const compiledContents = JSON.parse((await readFile(`${dir}/en.json`)).toString())
    await testContentSetup(t, adapter, key, content, contentOut, poContents, compiledContents, fnameIn, -1)
}

export const basic = adapter(adapterOpts)

export async function testContent(t: any, content: string, expectedContent: string, expectedTranslations: string, expectedCompiled: CompiledElement[], adapter=basic, hmrVersion=-1) {
    try {
        await rm(adapterOpts.localesDir, {recursive: true})
    } catch {}
    await testContentSetup(t, adapter, 'main', content, expectedContent, expectedTranslations, expectedCompiled, testFile, hmrVersion)
}

export async function testDir(t: any, dir: string, adapter=basic) {
    try {
        await rm(adapterOpts.localesDir, {recursive: true})
    } catch {}
    await testDirSetup(t, adapter, 'basic',`${dirBase}/${dir}`, 'app.js', 'app.out.js')
}

// only for syntax highlighting
export const ts = (foo: TemplateStringsArray) => foo.join('')
export const js = ts

// const code = ts`
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
