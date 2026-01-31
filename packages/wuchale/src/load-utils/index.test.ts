// $ node --import ../../testing/resolve.ts %f

import { test } from 'node:test'
// @ts-expect-error
import { testCatalog } from '../../testing/utils.ts'
import { defaultCollection, loadLocaleSync, registerLoaders } from './index.js'
import { loadCatalogs } from './pure.js'
import { loadLocales, runWithLocale } from './server.js'

const loaderFunc = () => testCatalog

test('Loading', async t => {
    const collection = {}
    const getRT = registerLoaders('main', loaderFunc, ['foo'], defaultCollection(collection))
    loadLocaleSync('en')
    t.assert.notEqual(collection['foo'], null) // setCatalogs was called
    const rt = getRT('foo')
    t.assert.equal(rt.l, 'en')
    const cPure = await loadCatalogs('en', ['foo'], loaderFunc)
    t.assert.equal(cPure['foo'].c[0], 'Hello')
})

test('Loading server side', async t => {
    const getRT = await loadLocales('main', ['main'], _ => testCatalog, ['en'])
    const msg = await runWithLocale('en', () => {
        return getRT('main')(1, ['server user'])
    })
    t.assert.equal(msg, 'Hello server user!')
})
