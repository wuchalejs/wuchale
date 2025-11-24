// $$ node %f

// @ts-expect-error
import { testContentSetup, testDirSetup, absDir, ts } from '../../wuchale/tests/check.ts'
import { rm } from 'fs/promises'
import { adapter, type SvelteArgs } from '@wuchale/svelte'
import type { CompiledElement } from 'wuchale'

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

export async function testContent(t: any, content: string, expectedContent: string, expectedTranslations: string, expectedCompiled: CompiledElement[], filename?: string, config?: SvelteArgs) {
    try {
        await rm(adapterOpts.localesDir, {recursive: true})
    } catch {}
    const adap = config ? adapter(config) : sv
    await testContentSetup(t, adap, 'svelte', content, expectedContent, expectedTranslations, expectedCompiled, filename ?? testFile)
}

export async function testDir(t: any, dir: string) {
    try {
        await rm(adapterOpts.localesDir, {recursive: true})
    } catch {}
    await testDirSetup(t, sv, 'svelte', `${dirBase}/${dir}`, 'app.svelte', 'app.out.svelte')
}

// only for syntax highlighting
export const svelte = ts
export const js = ts

// import { getOutput } from '../../wuchale/tests/check.js'
// const code = svelte`
//   <a href="/foo/{44}">Hello</a>
// `
// const p = await getOutput(sv, 'svelte', code, testFile, -1)
// console.log(p.code)
// // console.log(Object.values(p.catalogs.en))
// // console.log(p.compiled.en)
