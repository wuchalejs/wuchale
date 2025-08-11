// $$ cd .. && npm run test

import { test } from 'node:test'
import { testContent, testDir, jsx } from './check.js'

test('Simple text', async function(t) {
    await testContent(t, jsx`
        const m = <p>Hello</p>
    `, jsx`
        import WuchaleTrans from "@wuchale/jsx/runtime.jsx"
        import _w_load_ from "../tests/test-tmp/loader.js"
        const _w_runtime_ = _w_load_('jsx')
        const m = <p>{_w_runtime_.t(0)}</p>
    `, `
    msgid ""
    msgstr ""

    #: test-tmp/test.jsx
    msgid "Hello"
    msgstr "Hello"
    `, ['Hello'])
})
