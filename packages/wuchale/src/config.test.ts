// $ node --import ../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { fillDefaults } from './config.js'

test('Fill defaults', (t: TestContext) => {
    const def = {
        foo: 1,
        bar: {
            bee: 42,
            ext: [33],
        },
        fur: 0,
    }
    const usr = {
        fur: 4,
        bar: {
            bee: 21,
        },
    }
    t.assert.deepStrictEqual(fillDefaults(usr, def), {
        foo: 1,
        fur: 4,
        bar: {
            bee: 21,
            ext: [33],
        },
    })
})
