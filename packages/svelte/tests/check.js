// $$ node %f

// @ts-ignore
import { testContentSetup, testDirSetup, absDir, typescript } from '../../wuchale/tests/check.js'
import { rm } from 'fs/promises'
import { relative } from 'path'
import { adapter } from '@wuchale/svelte'

const dirBase = absDir(import.meta.url)
const adapterOpts = {
    files: `${dirBase}/test-tmp/*`,
    catalog: `${dirBase}/test-tmp/{locale}`
}

const sv = adapter(adapterOpts)

const testFile = relative(dirBase, `${dirBase}/test-tmp/test.svelte`)

/**
 * @param {any} t
 * @param {string} content
 * @param {string} expectedContent
 * @param {string} expectedTranslations
 * @param {string[] | string[][]} expectedCompiled
 */
export async function testContent(t, content, expectedContent, expectedTranslations, expectedCompiled) {
    try {
        await rm(adapterOpts.catalog.replace('{locale}', 'en.po'))
    } catch {}
    await testContentSetup(t, sv, 'svelte', content, expectedContent, expectedTranslations, expectedCompiled, testFile)
}

/**
 * @param {any} t
 * @param {string} dir
 */
export async function testDir(t, dir) {
    try {
        await rm(adapterOpts.catalog.replace('{locale}', 'en.po'))
    } catch {}
    await testDirSetup(t, sv, 'svelte', `${dirBase}/${dir}`, 'app.svelte', 'app.out.svelte')
}

// only for syntax highlighting
export const svelte = typescript
