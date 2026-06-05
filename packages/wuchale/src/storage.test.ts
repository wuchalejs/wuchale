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
            ['de', ['Hallo']],
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
    ['en', 'es', 'de'],
)

const createStor = (num: number, init: Item[] = []) => {
    const savedItems = { current: init }
    const stor: StorageFactory = ({ locales, sourceLocale }) => ({
        key: `stor${num}`,
        load: () => ({
            items: savedItems.current,
        }),
        save: data => {
            savedItems.current = data.items.map(i => ({
                ...i,
                translations: new Map(
                    Array.from(i.translations).filter(([l]) => l === sourceLocale || locales.includes(l)),
                ),
            }))
        },
        files: [`/stor${num}`],
    })
    return [savedItems, stor] as const
}

const [stor1Items, stor1] = createStor(1, [itemFull])
const [stor2Items, stor2] = createStor(2)

const storageOpts: StorageFactoryOpts = {
    locales: ['en', 'es', 'de'],
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
    t.assert.deepStrictEqual(stor2Items.current, [itemFull])
})

const itemFullUrl = newItem(
    {
        translations: new Map([
            ['en', ['/foo/*']],
            ['es', ['/bar/*']],
            ['de', ['/dee/*']],
        ]),
        references: [
            {
                file: 'src/file2.ts',
                refs: [{ placeholders: [['0', 'itemId']], link: '/foo/{0}' }],
            },
        ],
        urlAdapters: ['main', 'js'],
    },
    ['en', 'es', 'de'],
)

test('Storage by type works', async (t: TestContext) => {
    stor1Items.current = []
    stor2Items.current = []
    const storage = await storageByType({ message: stor1, url: stor2 })(storageOpts)
    t.assert.strictEqual(storage.key, 'stor1,stor2')
    t.assert.deepStrictEqual(storage.files, ['/stor1', '/stor2'])
    await storage.save({ pluralRules: new Map(), items: [itemFull, itemFullUrl] })
    t.assert.deepStrictEqual(stor1Items.current, [itemFull])
    t.assert.deepStrictEqual(stor2Items.current, [itemFullUrl])
    t.assert.deepStrictEqual((await storage.load()).items, [itemFull, itemFullUrl])
})

test('Storage by locale works', async (t: TestContext) => {
    stor1Items.current = []
    stor2Items.current = []
    const storage = await storageByLocale([
        [['es'], stor1],
        [['de'], stor2],
    ])(storageOpts)
    t.assert.strictEqual(storage.key, 'stor1,stor2')
    t.assert.deepStrictEqual(storage.files, ['/stor1', '/stor2'])
    const trans = Array.from(itemFull.translations)
    const itemNoDe: Item = { ...itemFull, translations: new Map(trans.filter(([l]) => l !== 'de')) }
    const itemNoEs: Item = { ...itemFull, translations: new Map(trans.filter(([l]) => l !== 'es')) }
    await storage.save({ pluralRules: new Map(), items: [itemFull] })
    t.assert.deepStrictEqual(stor1Items.current, [itemNoDe])
    t.assert.deepStrictEqual(stor2Items.current, [itemNoEs])
    t.assert.deepStrictEqual((await storage.load()).items, [itemFull])
})
