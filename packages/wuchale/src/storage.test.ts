// $$ node --import ../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
// @ts-expect-error
import { inMemFS } from '../testing/utils.ts'
import { type Item, migrateStorage, newItem, type StorageFactory } from './storage.js'

const itemFull = newItem(
    {
        references: [
            {
                file: 'src/file1.ts',
                refs: [null],
            },
            {
                file: 'src/file2.ts',
                refs: [{ placeholders: [[0, 'foo: bar;']] }, null],
            },
        ],
    },
    ['en', 'es'],
)
itemFull.translations.set('en', ['Hello'])
itemFull.translations.set('es', ['Hola'])

let storedItems: Item[] = []

const storageFrom: StorageFactory = () => ({
    key: 'foo',
    load: () => ({
        items: [itemFull],
    }),
    save: () => {}, // not saving
    files: ['/foo'],
})

const storageTo: StorageFactory = () => ({
    key: 'bar',
    load: () => ({
        items: [], // new, doesn't have anything saved
    }),
    save: data => {
        storedItems = data.items
    },
    files: [],
})

const migratorSt = migrateStorage([storageFrom], storageTo)

test('Migrate storage works', async (t: TestContext) => {
    const storage = await migratorSt({
        locales: ['en', 'es'],
        root: '/proj',
        localesDir: '/proj/locales',
        haveUrl: true,
        sourceLocale: 'en',
        fs: inMemFS,
    })
    t.assert.strictEqual(storage.key, 'bar')
    t.assert.deepStrictEqual(storage.files, ['/foo'])
    t.assert.deepStrictEqual((await storage.load()).items, [itemFull])
    await storage.save({ pluralRules: new Map(), items: [itemFull] })
    t.assert.deepStrictEqual(storedItems, [itemFull])
})
