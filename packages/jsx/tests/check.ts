// $$ node %f

// @ts-expect-error
import { testContentSetup, testDirSetup, absDir, ts } from '../../wuchale/tests/check.ts'
import { rm } from 'fs/promises'
import { adapter, type JSXArgs } from '@wuchale/jsx'
import type { CompiledElement } from 'wuchale'

const dirBase = absDir(import.meta.url)

export const adapterOpts: Partial<JSXArgs> = {
    files: `${dirBase}/test-dir/*`,
    localesDir: `${dirBase}/test-tmp/`,
    loader: 'default',
}

const testFile = `${dirBase}/test-dir/test.jsx`

export async function testContent(t: any, content: string, expectedContent: string | undefined, expectedTranslations: string, expectedCompiled: CompiledElement[], filename?: string, conf: object = adapterOpts) {
    try {
        await rm(adapterOpts.localesDir as string, {recursive: true})
    } catch {}
    await testContentSetup(t, adapter(conf as JSXArgs), 'jsx', content, expectedContent, expectedTranslations, expectedCompiled, filename ?? testFile)
}

const jx = adapter(adapterOpts)

export async function testDir(t: any, dir: string) {
    try {
        await rm(adapterOpts.localesDir + 'en.po')
    } catch {}
    await testDirSetup(t, jx, 'jsx', `${dirBase}/${dir}`, 'app.jsx', 'app.out.jsx')
}

// only for syntax highlighting
export const tsx = ts

// // @ts-expect-error
// import { getOutput } from '../../wuchale/tests/check.ts'
// const code = tsx`
// function m() {
//   return <p>Hello!</p>
// }
// `
// const p = await getOutput(jx, 'jsx', code, testFile, -1)
// console.log(p.code)
// // console.log(Object.values(p.catalogs.en))
// // console.log(p.compiled.en?.items)
