// $ node --import ../../testing/resolve.ts %f

import * as assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { POFile } from './pofile.js'

const writePO = async (filePath: string, body: string) => {
    await writeFile(
        filePath,
        `msgid ""
msgstr ""
"Plural-Forms: nplurals=2; plural=n != 1;\\n"

${body}
`,
    )
}

test('load handles missing keys in non-source locales', async t => {
    const dir = await mkdtemp(resolve(tmpdir(), 'wuchale-po-'))
    t.after(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    await writePO(resolve(dir, 'en.po'), 'msgid "Hello"\nmsgstr "Hello"\n')
    await writePO(resolve(dir, 'fr.po'), '')

    const pofile = new POFile({
        dir,
        root: dir,
        locales: ['en', 'fr'],
        sourceLocale: 'en',
        separateUrls: true,
        haveUrl: false,
    })
    const loaded = await pofile.load()

    assert.strictEqual(loaded.items.length, 1)
    const first = loaded.items[0]
    assert.ok(first)
    assert.deepStrictEqual(first.id, ['Hello'])
    assert.deepStrictEqual(first.translations.get('en'), ['Hello'])
    assert.deepStrictEqual(first.translations.get('fr'), [])
})

test('load keeps source-locale order and appends orphan keys deterministically', async t => {
    const dir = await mkdtemp(resolve(tmpdir(), 'wuchale-po-'))
    t.after(async () => {
        await rm(dir, { recursive: true, force: true })
    })

    await writePO(resolve(dir, 'en.po'), ['msgid "B"', 'msgstr "B"', '', 'msgid "C"', 'msgstr "C"', ''].join('\n'))
    await writePO(
        resolve(dir, 'fr.po'),
        ['msgid "A"', 'msgstr "A"', '', 'msgid "B"', 'msgstr "B FR"', '', 'msgid "C"', 'msgstr "C FR"', ''].join('\n'),
    )

    const pofile = new POFile({
        dir,
        root: dir,
        locales: ['fr', 'en'],
        sourceLocale: 'en',
        separateUrls: true,
        haveUrl: false,
    })
    const loaded = await pofile.load()

    assert.deepStrictEqual(
        loaded.items.map(i => i.id[0]),
        ['B', 'C', 'A'],
    )
    const orphan = loaded.items[2]
    assert.ok(orphan)
    assert.deepStrictEqual(orphan.translations.get('en'), [])
})
