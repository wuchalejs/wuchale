// $ node --import ../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { fillDefaults } from './config.js'

test('Fill defaults', (t: TestContext) => {
    const def = {
        foo: 1, // not given in usr
        bar: {
            bee: 42,
            ext: [33],
        },
        fur: 0,
        boo: { ber: 'foo' } as { ber: string } | string,
        ff: 33 as { boo: number } | number,
    }
    const usr = {
        fur: 4,
        bar: {
            bee: 21, // override inner
        },
        boo: 'boo', // override with non object
        ff: { boo: 11 }, // override with object
    }
    t.assert.deepStrictEqual(fillDefaults(usr, def), {
        foo: 1,
        fur: 4,
        bar: {
            bee: 21,
            ext: [33],
        },
        boo: 'boo',
        ff: { boo: 11 },
    })
})
