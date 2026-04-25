// $ node --import ../../testing/resolve.ts %f

import { test } from 'node:test'
// @ts-expect-error
import { testCatalog } from '../../testing/utils.ts'
import type { Runtime } from '../runtime.js'
import { defaultCollection, loadLocaleSync, registerLoaders } from './index.js'
import { loadCatalogs } from './pure.js'
import { loadLocales, runWithLocale } from './server.js'

const loaderFunc = () => testCatalog

test('Loading', async t => {
    const collection: Runtime[] = []
    const getRT = registerLoaders('main', loaderFunc, 1, defaultCollection(collection))
    loadLocaleSync('en')
    t.assert.notEqual(collection[0], null) // setCatalogs was called
    const rt = getRT()
    t.assert.equal(rt.l, 'en')
    const cPure = await loadCatalogs('en', [0], loaderFunc)
    t.assert.equal(cPure[0]!.c[0], 'Hello')
})

test('Loading server side', async t => {
    const getRT = await loadLocales('main', 1, _ => testCatalog, ['en'])
    const msg = await runWithLocale('en', () => {
        return getRT()(1, ['server user'])
    })
    t.assert.equal(msg, 'Hello server user!')
})
