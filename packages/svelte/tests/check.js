// $$ node %f

// @ts-ignore
import { testContentSetup, testDirSetup, absDir, typescript } from '../../wuchale/tests/check.js'
import { adapter } from '@wuchale/svelte'

const sv = adapter()

/**
 * @param {any} t
 * @param {string} content
 * @param {string} expectedContent
 * @param {string} expectedTranslations
 * @param {string[] | string[][]} expectedCompiled
 */
export async function testContent(t, content, expectedContent, expectedTranslations, expectedCompiled) {
    await testContentSetup(t, sv, 'svelte', content, expectedContent, expectedTranslations, expectedCompiled)
}

const dirBase = absDir(import.meta.url)

/**
 * @param {any} t
 * @param {string} dir
 */
export async function testDir(t, dir) {
    await testDirSetup(t, sv, 'svelte', `${dirBase}/${dir}`)
}

// only for syntax highlighting
export const svelte = typescript
