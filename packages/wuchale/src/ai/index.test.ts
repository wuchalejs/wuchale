// $ node --import ../../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { Logger } from '../log.js'
import type { Item } from '../storage.js'
import AIQueue, { type AI } from './index.js'

const ai: AI = {
    name: 'test',
    batchSize: 4,
    parallel: 2,
    group: {},
    async translate() {
        return JSON.stringify([
            { en: ['Welcome'], es: ['Bienvenido'] }, // omit de interntionally
            { en: ['Welcome'], es: ['Bienvenido'] }, // return more than asked
        ])
    },
}

const queue = new AIQueue('en', ai, async () => {}, new Logger('error'))

const item: Item = {
    id: ['Welcome'],
    translations: new Map([
        ['en', ['Welcome']],
        ['es', []],
        ['de', []],
    ]),
    references: [
        {
            file: 'src/routes/page.svelte',
            refs: [null],
        },
    ],
    urlAdapters: [],
}

test('Translations accepted correctly', async (t: TestContext) => {
    const cItem = structuredClone(item)
    queue.add([cItem])
    await queue.running
    t.assert.deepStrictEqual(cItem.translations.get('es'), ['Bienvenido'])
    t.assert.deepStrictEqual(cItem.translations.get('de'), [])
})

test('Group and prep items', async (t: TestContext) => {
    const items = Array(30)
        .fill(null)
        .map(_ => structuredClone(item))
    const groupedItems = queue.groupItemsByLocales(items)
    t.assert.equal(groupedItems.get('es')?.length, 30)
    t.assert.equal(groupedItems.get('de')?.length, 30)
    const opInfo = queue.prepItemsInBatches(groupedItems)
    t.assert.equal(opInfo.length, 16) // 7 * 4 + 1 * 2 = 30 for es and de
})
