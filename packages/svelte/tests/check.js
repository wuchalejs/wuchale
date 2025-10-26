// $$ node %f

// @ts-ignore
import { testContentSetup, testDirSetup, absDir, typescript } from '../../wuchale/tests/check.js'
import { rm } from 'fs/promises'
import { adapter } from '@wuchale/svelte'

const dirBase = absDir(import.meta.url)
const adapterOpts = {
    files: `${dirBase}/test-dir/*`,
    localesDir: `${dirBase}/test-tmp/`,
    loader: 'svelte',
}

const sv = adapter(adapterOpts)

const testFile = `${dirBase}/test-dir/test.svelte`
export const testFileJs = `${dirBase}/test-dir/test.svelte.js`

/**
 * @param {any} t
 * @param {string} content
 * @param {string} expectedContent
 * @param {string} expectedTranslations
 * @param {string[] | string[][]} expectedCompiled
 * @param {string} [filename]
 */
export async function testContent(t, content, expectedContent, expectedTranslations, expectedCompiled, filename) {
    try {
        await rm(adapterOpts.localesDir, {recursive: true})
    } catch {}
    await testContentSetup(t, sv, 'svelte', content, expectedContent, expectedTranslations, expectedCompiled, filename ?? testFile)
}

/**
 * @param {any} t
 * @param {string} dir
 */
export async function testDir(t, dir) {
    try {
        await rm(adapterOpts.localesDir, {recursive: true})
    } catch {}
    await testDirSetup(t, sv, 'svelte', `${dirBase}/${dir}`, 'app.svelte', 'app.out.svelte')
}

// only for syntax highlighting
export const svelte = typescript
export const javascript = typescript

// import { getOutput } from '../../wuchale/tests/check.js'
// const code = svelte`
//   <main>Hello</main>
// `
// const p = await getOutput(sv, 'svelte', code, testFile, -1)
// console.log(p.code)
// console.log(Object.values(p.catalogs.en))
// console.log(p.compiled.en)
