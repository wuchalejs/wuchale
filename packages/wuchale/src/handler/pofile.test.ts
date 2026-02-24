// $ node --import ../../testing/resolve.ts %f

import { test } from 'node:test'
import PO from 'pofile'
import { itemToPOItem, poitemToItem } from './pofile.js'

test('preserve comments and non-url flags in PO roundtrip', t => {
    const po_item = new PO.Item()
    po_item.msgid = 'Hello'
    po_item.msgstr = ['Hello']
    po_item.comments = ['translator note']
    po_item.flags = {
        fuzzy: true,
        c_format: true,
        'url:vanilla': true,
    }
    po_item.references = ['src/a.ts']
    po_item.extractedComments = []

    const converted = poitemToItem(po_item)
    const roundtrip = itemToPOItem(converted)

    t.assert.deepStrictEqual(roundtrip.comments, ['translator note'])
    t.assert.strictEqual(roundtrip.flags.fuzzy, true)
    t.assert.strictEqual(roundtrip.flags.c_format, true)
    t.assert.strictEqual(roundtrip.flags['url:vanilla'], true)
})
