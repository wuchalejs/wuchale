// $$ node %f

// @ts-expect-error
import { testContentSetup, testDirSetup, absDir, ts } from '../../wuchale/tests/check.ts'
import { rm } from 'fs/promises'
import { adapter, type SvelteArgs } from '@wuchale/svelte'
import type { CompiledElement } from 'wuchale'

const dirBase = absDir(import.meta.url)

export const adapterOpts: Partial<SvelteArgs> = {
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

export async function testContent(t: any, content: string, expectedContent: string | undefined, expectedTranslations: string, expectedCompiled: CompiledElement[], filename?: string, config?: Partial<SvelteArgs>) {
    try {
        await rm(adapterOpts.localesDir as string, {recursive: true})
    } catch {}
    const adap = config ? adapter(config) : sv
    await testContentSetup(t, adap, 'svelte', content, expectedContent, expectedTranslations, expectedCompiled, filename ?? testFile)
}

export async function testDir(t: any, dir: string) {
    try {
        await rm(adapterOpts.localesDir as string, {recursive: true})
    } catch {}
    await testDirSetup(t, sv, 'svelte', `${dirBase}/${dir}`, 'app.svelte', 'app.out.svelte')
}

// only for syntax highlighting
export const svelte = ts
export const js = ts

// // @ts-expect-error
// import { getOutput } from '../../wuchale/tests/check.ts'
// const code = svelte`
//   <a href="/foo/{44}">Hello</a>
// `
// const p = await getOutput(sv, 'svelte', code, testFile, -1)
// console.log(p.code)
// // console.log(p.catalogs.get('en').catalog.values())
// // console.log(p.compiled.get('en').items)
