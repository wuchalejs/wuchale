// $$ node %f

import { testContentSetup, testDirSetup, absDir, ts, getOutput } from '../../wuchale/tests/check.ts'
import { rm, readdir, readFile } from 'fs/promises'
import { adapter, type AstroArgs } from '@wuchale/astro'
import type { CompiledElement } from 'wuchale'
import PO from 'pofile'

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
 * Extract template content (after the frontmatter `---`)
 */
function extractTemplate(content: string): string {
    const match = content.match(/---\n[\s\S]*?---\n([\s\S]*)/)
    return match ? match[1].trim() : content.trim()
}

function trimLines(str: string) {
    if (!str) return
    let result: string[] = []
    for (const line of str.split('\n')) {
        if (line.trim()) result.push(line.trim())
    }
    return result.join('\n')
}

/**
 * Test content with wrapper component generation.
 * Verifies: template output, translations, compiled elements, and wrapper templates.
 */
export async function testContentWithWrappers(
    t: any,
    content: string,
    expectedTemplate: string,
    expectedTranslations: string,
    expectedCompiled: CompiledElement[],
    expectedWrapperTemplates?: string[],
    filename?: string,
    conf: object = adapterOpts
) {
    try {
        await rm(adapterOpts.localesDir as string, { recursive: true })
    } catch {}

    const { code, catalogs, compiled } = await getOutput(
        adapter(conf as AstroArgs),
        'astro',
        content,
        filename ?? testFile,
        -1
    )

    // Extract and compare just the template part (after frontmatter)
    const actualTemplate = extractTemplate(code)
    t.assert.strictEqual(
        actualTemplate,
        expectedTemplate.trim(),
        `Template mismatch.\nExpected:\n${expectedTemplate.trim()}\n\nActual:\n${actualTemplate}`
    )

    // Check translations
    const po = new PO()
    for (const key in catalogs.en.catalog) {
        po.items.push(catalogs.en.catalog[key])
    }
    t.assert.strictEqual(
        trimLines(po.toString()),
        trimLines(expectedTranslations)
    )

    // Check compiled elements
    t.assert.deepEqual(compiled.en?.items ?? [], expectedCompiled)

    // Check wrapper files
    const wuchaleDir = `${adapterOpts.localesDir}.wuchale`
    let wrapperFiles: string[] = []
    try {
        wrapperFiles = (await readdir(wuchaleDir)).filter(f => f.endsWith('.astro'))
    } catch {}

    const expectedWrapperCount = expectedWrapperTemplates?.length ?? 0
    t.assert.strictEqual(
        wrapperFiles.length,
        expectedWrapperCount,
        `Expected ${expectedWrapperCount} wrapper files, got ${wrapperFiles.length}`
    )

    // Verify wrapper template content (just the template, not frontmatter)
    if (expectedWrapperTemplates) {
        for (let i = 0; i < expectedWrapperTemplates.length; i++) {
            if (wrapperFiles[i]) {
                const wrapperContent = await readFile(`${wuchaleDir}/${wrapperFiles[i]}`, 'utf-8')
                const actualWrapperTemplate = extractTemplate(wrapperContent)
                t.assert.strictEqual(
                    actualWrapperTemplate,
                    expectedWrapperTemplates[i].trim(),
                    `Wrapper ${i} template mismatch.\nExpected:\n${expectedWrapperTemplates[i].trim()}\n\nActual:\n${actualWrapperTemplate}`
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
