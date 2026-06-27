// $ cd .. && node --import ../testing/resolve.ts handler/index.test.ts

import { resolve } from 'node:path'
import { type TestContext, test } from 'node:test'
// @ts-expect-error
import { dummyTransform, inMemFS, inMemStorage, trimLines, ts } from '../../testing/utils.ts'
import { defaultArgs } from '../adapter-vanilla/index.js'
import { type Adapter, newMessage } from '../adapters.js'
import { defaultConfig } from '../config.js'
import { Logger } from '../log.js'
import { generatedDir } from './files.js'
import { AdapterHandler, getFallbackChains } from './index.js'
import { SharedState } from './state.js'

const defaultLoaderPath = '/loader/template/js'
inMemFS.write(defaultLoaderPath, '')

const adapter: Adapter = {
    ...defaultArgs,
    transform: dummyTransform,
    files: '*.js', // filename needs to match
    storage: inMemStorage,
    loaderExts: ['.js'],
    defaultLoaderPath: defaultLoaderPath,
}

async function makeHandler() {
    const storage = await inMemStorage({
        locales: ['en'],
        root: import.meta.dirname,
        sourceLocale: 'en',
        localesDir: 'src/locales',
        fs: inMemFS,
    })

    return await AdapterHandler.create({
        adapter,
        primary: true,
        key: 'test',
        config: defaultConfig,
        mode: 'dev',
        fs: inMemFS,
        root: import.meta.dirname,
        log: new Logger('error'),
        sourceLocale: 'en',
        sharedState: new SharedState(storage, 'test', 'en', true),
        devMode: 'refs',
        modifyInplace: false,
    })
}

const handler = await makeHandler()

test('HMR', async (t: TestContext) => {
    const content = ts`'Hello'`
    t.assert.strictEqual(
        trimLines((await handler.transform(content, 'test.js', true))[0].code),
        trimLines(ts`
        import {getRuntime as _w_load_hmr_, getRuntimeRx as _w_load_rx_hmr_} from "./src/locales/test.loader.js"
        import {updated as _w_updated_} from "wuchale/dev"
        const [_w_load_, _w_load_rx_] = _w_updated_(_w_load_hmr_, _w_load_rx_hmr_, {"en":[[0,"Hello"]]})
        _w_load_()(0)
    `),
    )
    // not on SSR
    t.assert.strictEqual(
        trimLines((await handler.transform(content, 'test.js', true, true))[0].code),
        trimLines(ts`
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "./src/locales/test.loader.js"
        _w_load_()(0)
    `),
    )
})

test('Manifest', async (t: TestContext) => {
    const manifestPath = resolve(import.meta.dirname, defaultConfig.localesDir, generatedDir, 'test.0.manifest.js')
    const content = await inMemFS.read(manifestPath)
    t.assert.strictEqual(
        trimLines(content!),
        trimLines(
            `/** @type {(string | string[] | {text: string | string[], context?: string, isUrl?: boolean})[]} */\nexport const keys = ["Hello"]`,
        ),
    )
})

test('Handle messages', async (t: TestContext) => {
    const msgs = [newMessage({ msgStr: ['Hello'] })]
    const [hmrKeys, updated] = await handler.handleMessages(msgs, 'foo.ts', true)
    t.assert.strictEqual(updated, true)
    t.assert.deepStrictEqual(hmrKeys, ['Hello'])
    // @ts-expect-error
    const msgs1 = [newMessage({ msgStr: ['Hello'], context: null })]
    const [, updated1] = await handler.handleMessages(msgs1, 'foo.ts', true)
    t.assert.strictEqual(updated1, false)
    const [, updated2] = await handler.handleMessages(msgs, 'bar.ts', true)
    t.assert.strictEqual(updated2, true)
})

test('Handler compiles only when necessary', async (t: TestContext) => {
    const handler = await makeHandler()
    const msgs = [newMessage({ msgStr: ['Hello'] })]
    let saveCalls = 0
    let compileCalls = 0
    const handlerSaveStorage = handler.saveStorage.bind(handler)
    const handlerCompile = handler.compile.bind(handler)
    handler.saveStorage = async () => {
        saveCalls++
        await handlerSaveStorage()
    }
    handler.compile = async (...args) => {
        compileCalls++
        return handlerCompile(...args)
    }
    const [, updated1] = await handler.handleMessages(msgs, 'foo.ts', true)
    t.assert.strictEqual(updated1, true)
    t.assert.strictEqual(saveCalls, 1)
    t.assert.strictEqual(compileCalls, 1)
    const [, updated2] = await handler.handleMessages(msgs, 'bar.ts', true)
    t.assert.strictEqual(updated2, true)
    t.assert.strictEqual(saveCalls, 2)
    t.assert.strictEqual(compileCalls, 1)
})

test('Fallback chains', (t: TestContext) => {
    const chains = getFallbackChains(
        {
            'fr-ch': 'de-en',
            de: 'fr',
        },
        ['fr-ch', 'de-en', 'de', 'fr', 'en'],
        'en',
    )
    t.assert.deepStrictEqual(
        chains,
        new Map([
            ['en', ['en']],
            ['fr-ch', ['fr-ch', 'de-en', 'de', 'fr', 'en']],
            ['de-en', ['de-en', 'de', 'fr', 'en']],
            ['de', ['de', 'fr', 'en']],
            ['fr', ['fr', 'en']],
        ]),
    )
})
