// $$ node %f

// @ts-expect-error
import { testContentSetup, testDirSetup, absDir, ts } from '../../wuchale/tests/check.ts'
import { rm } from 'fs/promises'
import { adapter, type AstroArgs } from '@wuchale/astro'
import type { CompiledElement } from 'wuchale'

const dirBase = absDir(import.meta.url)

export const adapterOpts: Partial<AstroArgs> = {
    files: `${dirBase}/test-dir/*`,
    localesDir: `${dirBase}/test-tmp/`,
    loader: 'default',
}

const testFile = `${dirBase}/test-dir/test.astro`

const astroAdapter = adapter(adapterOpts)

export async function testContent(
    t: any,
    content: string,
    expectedContent: string | undefined,
    expectedTranslations: string,
    expectedCompiled: CompiledElement[],
    filename?: string,
    conf: object = adapterOpts
) {
    try {
        await rm(adapterOpts.localesDir as string, { recursive: true })
    } catch {}
    await testContentSetup(
        t,
        adapter(conf as AstroArgs),
        'astro',
        content,
        expectedContent,
        expectedTranslations,
        expectedCompiled,
        filename ?? testFile
    )
}

export async function testDir(t: any, dir: string) {
    try {
        await rm(adapterOpts.localesDir + 'en.po')
    } catch {}
    await testDirSetup(t, astroAdapter, 'astro', `${dirBase}/${dir}`, 'app.astro', 'app.out.astro')
}

// Template literal tag for syntax highlighting in tests
export const astro = ts

// // @ts-expect-error
// import { getOutput } from '../../wuchale/tests/check.ts'
// const code = astro`
//     <p>Hello</p>
// `
// const p = await getOutput(astroAdapter, 'astro', code, testFile, -1)
// console.log(p.code)
// // console.log(p.catalogs.get('en').catalog.values())
// // console.log(p.compiled.get('en').items)
