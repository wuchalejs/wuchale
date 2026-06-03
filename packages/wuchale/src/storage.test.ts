// $$ node --import ../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
// @ts-expect-error
import { inMemFS } from '../testing/utils.ts'
import {
    type Item,
    migrateStorage,
    newItem,
    type StorageFactory,
    type StorageFactoryOpts,
    storageByLocale,
    storageByType,
} from './storage.js'

const itemFull = newItem(
    {
        translations: new Map([
            ['en', ['Hello']],
            ['es', ['Hola']],
        ]),
        references: [
            {
                file: 'src/file1.ts',
                refs: [null],
            },
            {
                file: 'src/file2.ts',
                refs: [{ placeholders: [['0', 'name']] }, null],
            },
        ],
    },
    ['en', 'es'],
)

let stor1Items: Item[] = [itemFull]

const stor1: StorageFactory = ({ locales }) => ({
    key: 'stor1',
    load: () => ({
        items: stor1Items,
    }),
    save: data => {
        stor1Items = data.items.filter(i => locales.some(l => i.translations.has(l)))
    },
    files: ['/stor1'],
})

let stor2Items: Item[] = []

const stor2: StorageFactory = ({ locales }) => ({
    key: 'stor2',
    load: () => ({
        items: stor2Items,
    }),
    save: data => {
        stor2Items = data.items.filter(i => locales.some(l => i.translations.has(l)))
    },
    files: ['/stor2'],
})

const storageOpts: StorageFactoryOpts = {
    locales: ['en', 'es'],
    root: '/proj',
    localesDir: '/proj/locales',
    sourceLocale: 'en',
    fs: inMemFS,
}

test('Migrate storage works', async (t: TestContext) => {
    const storage = await migrateStorage([stor1], stor2)(storageOpts)
    t.assert.strictEqual(storage.key, 'stor2')
    t.assert.deepStrictEqual(storage.files, ['/stor1'])
    t.assert.deepStrictEqual((await storage.load()).items, [itemFull])
    await storage.save({ pluralRules: new Map(), items: [itemFull] })
    t.assert.deepStrictEqual(stor2Items, [itemFull])
})

const itemFullUrl = newItem(
    {
        translations: new Map([
            ['en', ['/foo/*']],
            ['es', ['/bar/*']],
        ]),
        references: [
            {
                file: 'src/file2.ts',
                refs: [{ placeholders: [['0', 'itemId']], link: '/foo/{0}' }],
            },
        ],
        urlAdapters: ['main', 'js'],
    },
    ['en', 'es'],
)

test('Storage by type works', async (t: TestContext) => {
    stor1Items = []
    stor2Items = []
    const storage = await storageByType({ message: stor1, url: stor2 })(storageOpts)
    t.assert.strictEqual(storage.key, 'stor1,stor2')
    t.assert.deepStrictEqual(storage.files, ['/stor1', '/stor2'])
    await storage.save({ pluralRules: new Map(), items: [itemFull, itemFullUrl] })
    t.assert.deepStrictEqual(stor1Items, [itemFull])
    t.assert.deepStrictEqual(stor2Items, [itemFullUrl])
    t.assert.deepStrictEqual((await storage.load()).items, [itemFull, itemFullUrl])
})

test('Storage by locale works', async (t: TestContext) => {
    stor1Items = []
    stor2Items = []
    const storage = await storageByLocale(
        [
            [['en'], stor1],
            [['es'], stor2],
        ],
        stor1,
    )(storageOpts)
    t.assert.strictEqual(storage.key, 'stor1,stor2')
    t.assert.deepStrictEqual(storage.files, ['/stor1', '/stor2'])
    const enItem: Item = { ...itemFull, translations: new Map([['en', itemFull.translations.get('en')!]]) }
    await storage.save({ pluralRules: new Map(), items: [enItem] })
    t.assert.deepStrictEqual(stor1Items, [enItem])
    t.assert.deepStrictEqual(stor2Items, [])
    t.assert.deepStrictEqual((await storage.load()).items, [enItem])
})
