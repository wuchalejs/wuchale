// $$ node %f

// @ts-ignore
import { testContentSetup, testDirSetup, absDir, typescript } from '../../wuchale/tests/check.js'
import { rm } from 'fs/promises'
import { adapter } from '@wuchale/svelte'

const dirBase = absDir(import.meta.url)
export const adapterOpts = {
    files: `${dirBase}/**/*`,
    localesDir: `${dirBase}/test-tmp/`,
    // url: {
    //     patterns: ['/*rest'],
    //     localize: true
    // },
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
 * @param {(string | (string | number)[])[]} expectedCompiled
 * @param {string} [filename]
 * @param {object} [config]
 */
export async function testContent(t, content, expectedContent, expectedTranslations, expectedCompiled, filename, config) {
    try {
        await rm(adapterOpts.localesDir, {recursive: true})
    } catch {}
    const adap = config ? adapter(config) : sv
    await testContentSetup(t, adap, 'svelte', content, expectedContent, expectedTranslations, expectedCompiled, filename ?? testFile)
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
//   <a href="/foo/{44}">Hello</a>
// `
// const p = await getOutput(sv, 'svelte', code, testFile, -1)
// console.log(p.code)
// // console.log(Object.values(p.catalogs.en))
// // console.log(p.compiled.en)
