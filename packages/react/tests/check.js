// $$ node %f

// @ts-ignore
import { testContentSetup, testDirSetup, absDir, typescript } from '../../wuchale/tests/check.js'
import { rm } from 'fs/promises'
import { relative } from 'path'
import { adapter } from '@wuchale/react'

const dirBase = absDir(import.meta.url)
const adapterOpts = {
    files: `${dirBase}/test-tmp/*`,
    catalog: `${dirBase}/test-tmp/{locale}`
}

const sv = adapter(adapterOpts)

const testFile = relative(dirBase, `${dirBase}/test-tmp/test.jsx`)

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
        await rm(adapterOpts.catalog.replace('{locale}', 'en.po'))
    } catch {}
    await testContentSetup(t, sv, 'react', content, expectedContent, expectedTranslations, expectedCompiled, filename ?? testFile)
}

/**
 * @param {any} t
 * @param {string} dir
 */
export async function testDir(t, dir) {
    try {
        await rm(adapterOpts.catalog.replace('{locale}', 'en.po'))
    } catch {}
    await testDirSetup(t, sv, 'react', `${dirBase}/${dir}`, 'app.jsx', 'app.out.jsx')
}

// only for syntax highlighting
export const jsx = typescript

// import { getOutput } from '../../wuchale/tests/check.js'
// const code = jsx`
//   const m = <main>
//     <p class="read-the-docs">
//       Click on the Vite and Svelte logos to learn more
//     </p>
//   </main>
// `
// const p = await getOutput(sv, 'react', code, testFile)
// console.log(p.code)
// console.log(Object.values(p.catalogs.en))
// console.log(p.compiled.en)
