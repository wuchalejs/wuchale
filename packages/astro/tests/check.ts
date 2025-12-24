// $$ node %f

import { testContentSetup, testDirSetup, absDir, ts, getOutput } from '../../wuchale/tests/check.ts'
import { rm, readdir, readFile } from 'fs/promises'
import { adapter, type AstroArgs } from '@wuchale/astro'
import type { CompiledElement } from 'wuchale'

const dirBase = absDir(import.meta.url)

export const adapterOpts: Partial<AstroArgs> = {
    files: `${dirBase}/test-dir/*`,
    localesDir: `${dirBase}/test-tmp/`,
    loader: 'default',
}

const testFile = `${dirBase}/test-dir/test.astro`

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

/**
 * Test content with wrapper component generation.
 * Uses regex pattern matching for dynamic parts like hash values.
 */
export async function testContentWithWrappers(
    t: any,
    content: string,
    expectedContentPattern: RegExp,
    expectedTranslations: string,
    expectedCompiled: CompiledElement[],
    expectedWrapperCount: number,
    wrapperContentPatterns?: RegExp[],
    filename?: string,
    conf: object = adapterOpts
) {
    try {
        await rm(adapterOpts.localesDir as string, { recursive: true })
    } catch {}

    const { code } = await getOutput(
        adapter(conf as AstroArgs),
        'astro',
        content,
        filename ?? testFile,
        -1
    )

    // Test that the output matches the expected pattern
    t.assert.ok(
        expectedContentPattern.test(code),
        `Output should match pattern.\nActual output:\n${code}`
    )

    // Check wrapper files were created
    const wuchaleDir = `${adapterOpts.localesDir}.wuchale`
    let wrapperFiles: string[] = []
    try {
        wrapperFiles = (await readdir(wuchaleDir)).filter(f => f.endsWith('.astro'))
    } catch {}

    t.assert.strictEqual(
        wrapperFiles.length,
        expectedWrapperCount,
        `Expected ${expectedWrapperCount} wrapper files, got ${wrapperFiles.length}`
    )

    // Optionally verify wrapper content
    if (wrapperContentPatterns) {
        for (let i = 0; i < wrapperContentPatterns.length; i++) {
            if (wrapperFiles[i]) {
                const wrapperContent = await readFile(`${wuchaleDir}/${wrapperFiles[i]}`, 'utf-8')
                t.assert.ok(
                    wrapperContentPatterns[i].test(wrapperContent),
                    `Wrapper ${i} should match pattern.\nActual:\n${wrapperContent}`
                )
            }
        }
    }
}

const astroAdapter = adapter(adapterOpts)

export async function testDir(t: any, dir: string) {
    try {
        await rm(adapterOpts.localesDir + 'en.po')
    } catch {}
    await testDirSetup(t, astroAdapter, 'astro', `${dirBase}/${dir}`, 'app.astro', 'app.out.astro')
}

// Template literal tag for syntax highlighting in tests
export const astro = ts
