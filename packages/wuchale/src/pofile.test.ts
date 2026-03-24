// $ node --import ../testing/resolve.ts %f

import { resolve } from 'node:path'
import { type TestContext, test } from 'node:test'
// @ts-expect-error
import { inMemFS } from '../testing/utils.ts'
import { POFile, pofile } from './pofile.js'
import { defaultPluralRule, type Item, newItem, type SaveData } from './storage.js'

function makeSaveData(items: Item[]): SaveData {
    return {
        items,
        pluralRules: new Map([
            ['en', defaultPluralRule],
            ['es', defaultPluralRule],
        ]),
    }
}

const item = newItem(
    {
        references: [
            {
                file: 'src/file.ts',
                refs: [{ placeholders: [[0, 'foo: bar;']] }, null],
            },
        ],
    },
    ['en', 'es'],
)
item.translations.set('en', ['Hello'])
item.translations.set('es', ['Hola'])

const root = '/projects'

const po = new POFile({
    dir: 'src/locales',
    separateUrls: true,
    locales: ['en', 'es'],
    root,
    haveUrl: true,
    sourceLocale: 'en',
    fs: inMemFS,
})

test('POFile round-trips reference metadata', async (t: TestContext) => {
    await po.save(makeSaveData([item]))
    const loaded = await po.load()
    t.assert.deepStrictEqual(loaded.items[0].references, item.references)
})

test('POFile loads items without the source locale file', async (t: TestContext) => {
    await po.save(makeSaveData([item]))
    await inMemFS.unlink(resolve(root, 'src/locales/en.po'))
    const loaded = await po.load()
    t.assert.deepStrictEqual(loaded.items[0].translations.get('en'), ['Hello'])
    t.assert.deepStrictEqual(loaded.items[0].translations.get('es'), ['Hola'])
})

test('POFile removes stale url catalogs', async (t: TestContext) => {
    const item = newItem(
        {
            urlAdapters: ['test'],
        },
        ['en', 'es'],
    )
    item.translations.set('en', ['/items/{0}'])
    item.translations.set('es', ['/elementos/{0}'])
    await po.save(makeSaveData([item]))
    const urlPath = resolve(root, 'src/locales/es.url.po')
    t.assert.strictEqual(await inMemFS.exists(urlPath), true)
    await po.save(makeSaveData([]))
    t.assert.strictEqual(await inMemFS.exists(urlPath), false)
})

test('pofile defaults dir to localesDir when not explicitly configured', (t: TestContext) => {
    const storage = pofile()({
        locales: ['en'],
        root,
        localesDir: 'custom/locales',
        haveUrl: false,
        sourceLocale: 'en',
        fs: inMemFS,
    })

    t.assert.strictEqual(storage.key, resolve(root, 'custom/locales'))
    t.assert.deepStrictEqual(storage.files, [
        resolve(root, 'custom/locales/en.po'),
        resolve(root, 'custom/locales/en.url.po'),
    ])
})
