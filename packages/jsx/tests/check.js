// $$ node %f

// @ts-ignore
import { testContentSetup, testDirSetup, absDir, typescript } from '../../wuchale/tests/check.js'
import { rm } from 'fs/promises'
import { relative } from 'path'
import { adapter } from '@wuchale/jsx'

const dirBase = absDir(import.meta.url)
export const adapterOpts = {
    files: `${dirBase}/test-tmp/*`,
    catalog: `${dirBase}/test-tmp/{locale}`
}

const testFile = relative(dirBase, `${dirBase}/test-tmp/test.jsx`)

/**
 * @param {any} t
 * @param {string} content
 * @param {string} expectedContent
 * @param {string} expectedTranslations
 * @param {string[] | string[][]} expectedCompiled
 * @param {string} [filename]
 * @param {object} [conf]
 */
export async function testContent(t, content, expectedContent, expectedTranslations, expectedCompiled, filename, conf = adapterOpts) {
    try {
        await rm(conf.catalog.replace('{locale}', 'en.po'))
    } catch {}
    await testContentSetup(t, adapter(conf), 'jsx', content, expectedContent, expectedTranslations, expectedCompiled, filename ?? testFile)
}

const jx = adapter(adapterOpts)

/**
 * @param {any} t
 * @param {string} dir
 */
export async function testDir(t, dir) {
    try {
        await rm(adapterOpts.catalog.replace('{locale}', 'en.po'))
    } catch {}
    await testDirSetup(t, jx, 'jsx', `${dirBase}/${dir}`, 'app.jsx', 'app.out.jsx')
}

// only for syntax highlighting
export const jsx = typescript

// import { getOutput } from '../../wuchale/tests/check.js'
// const code = jsx`
// function m() {
//   return <p>Hello!</p>
// }
// `
// const p = await getOutput(jx, 'jsx', code, testFile, -1)
// console.log(p.code)
// // console.log(Object.values(p.catalogs.en))
// // console.log(p.compiled.en?.items)
