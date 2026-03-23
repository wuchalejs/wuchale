// $ node --import ../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { deepMergeObjects, defaultConfig } from './config.js'

test('Deep merge does not mutate nested defaults', (t: TestContext) => {
    const defaults = {
        runtime: {
            plain: {
                wrapInit: 'plain',
            },
        },
    }
    const custom = deepMergeObjects(
        {
            runtime: {
                plain: {
                    wrapInit: 'custom',
                },
            },
        },
        defaults,
    )

    t.assert.equal(custom.runtime.plain.wrapInit, 'custom')
    t.assert.equal(defaults.runtime.plain.wrapInit, 'plain')
    t.assert.equal(deepMergeObjects({}, defaults).runtime.plain.wrapInit, 'plain')

    deepMergeObjects({ fallback: { es: 'en' } }, defaultConfig)
    t.assert.deepEqual(defaultConfig.fallback, {})
    t.assert.deepEqual(deepMergeObjects({}, defaultConfig).fallback, {})
})
