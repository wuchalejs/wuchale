// $ cd .. && node --import ../testing/resolve.ts handler/state.test.ts

import { type TestContext, test } from 'node:test'
import { type Item, newItem } from '../storage.js'
import { SharedState } from './state.js'

const item = (text: string) => newItem({ translations: new Map([['en', text]]) }, ['en'])
const texts = (items: Item[]) => items.map(i => i.translations.get('en'))

test('Items removed from storage are not saved back', async (t: TestContext) => {
    let stored = [item('Kept'), item('Removed')]
    const state = new SharedState(
        { key: 'test', files: [], load: () => stored, save: items => void (stored = items) },
        'test',
        'en',
        true,
    )
    await state.load(['en'])

    stored = [item('Kept')]
    await state.load(['en'])
    t.assert.strictEqual(state.catalog.size, 2)

    await state.save(false)
    t.assert.deepStrictEqual(texts(stored), ['Kept'])

    state.catalog.get('Removed')!.references.push({ file: 'a.js', refs: [null] })
    await state.save(false)
    t.assert.deepStrictEqual(texts(stored), ['Kept', 'Removed'])
})
