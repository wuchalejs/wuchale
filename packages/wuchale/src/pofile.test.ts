// $ node --import ../testing/resolve.ts %f

import { resolve } from 'node:path'
import { type TestContext, test } from 'node:test'
import { fileURLToPath } from 'node:url'
// @ts-expect-error
import { inMemFS } from '../testing/utils.ts'
import { POFile, pofile } from './pofile.js'
import { type CatalogStorage, type Item, newItem } from './storage.js'

const root = '/projects'

const itemFull = newItem(
    {
        references: [
            {
                file: 'src/file1.ts',
                refs: [null],
            },
            {
                file: 'src/file2.ts',
                refs: [{ placeholders: [['0', 'foo: bar;']] }, null],
            },
        ],
    },
    ['en', 'es'],
)
itemFull.translations.set('en', ['Hello'])
itemFull.translations.set('es', ['Hola'])

const itemMin: Item = { ...itemFull, references: itemFull.references.map(r => ({ ...r, refs: [null] })) }

export function testStorage(storage: CatalogStorage, name: string, minimal = false) {
    const item = minimal ? itemMin : itemFull

    test(`${name} round-trips reference metadata`, async (t: TestContext) => {
        await storage.save([item])
        const items = await storage.load()
        t.assert.deepStrictEqual(items[0]!.references, item.references)
    })

    test(`${name} loads items without the source locale file`, async (t: TestContext) => {
        await storage.save([item])
        await inMemFS.unlink(resolve(root, 'src/locales/en.po'))
        const items = await storage.load()
        t.assert.deepStrictEqual(items[0]!.translations.get('en'), ['Hello'])
        t.assert.deepStrictEqual(items[0]!.translations.get('es'), ['Hola'])
    })

    test(`${name} removes stale catalogs`, async (t: TestContext) => {
        await storage.save([])
        const catPath = resolve(root, 'src/locales/en.po')
        t.assert.strictEqual(await inMemFS.exists(catPath), false)
    })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const pofileOpts = {
        location: 'src/locales/{locale}.po',
        separateUrls: true,
        locales: ['en', 'es'],
        root,
        haveUrl: true,
        localesDir: 'src/locales',
        sourceLocale: 'en',
        fs: inMemFS,
    }
    const po = new POFile(pofileOpts)

    testStorage(po, 'POFile')

    test('POFile skips unlinking non existent catalogs', async (t: TestContext) => {
        let unlinkCalls = 0
        const fs = {
            ...inMemFS,
            unlink(file: string) {
                unlinkCalls++
                return inMemFS.unlink(file)
            },
        }
        const po = new POFile({ ...pofileOpts, fs })
        await po.save([itemFull])
        const reloaded = new POFile({ ...pofileOpts, fs })
        await reloaded.load()
        unlinkCalls = 0
        await reloaded.save([itemFull])
        t.assert.strictEqual(unlinkCalls, 0)
    })

    test('pofile defaults dir to localesDir', async (t: TestContext) => {
        const storage = await pofile()({
            locales: ['en'],
            root,
            localesDir: 'custom/locales',
            sourceLocale: 'en',
            fs: inMemFS,
        })
        t.assert.strictEqual(storage.key, resolve(root, 'custom/locales/{locale}.po'))
        t.assert.deepStrictEqual(storage.files, [resolve(root, 'custom/locales/en.po')])
    })
}
