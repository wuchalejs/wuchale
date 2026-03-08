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

test('Translations accepted correctly', async (t: TestContext) => {
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
    queue.add([item])
    await queue.running
    t.assert.deepStrictEqual(item.translations.get('es'), ['Bienvenido'])
    t.assert.deepStrictEqual(item.translations.get('de'), [])
})
