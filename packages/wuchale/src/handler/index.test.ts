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
import { AdapterHandler } from './index.js'
import { SharedState } from './state.js'

const adapter: Adapter = {
    ...defaultArgs,
    transform: dummyTransform,
    files: '*.js', // filename needs to match
    storage: inMemStorage,
    loaderExts: ['.js'],
    defaultLoaderPath: resolve(import.meta.dirname, '../adapter-vanilla/loaders/server.js'),
}

const handler = new AdapterHandler(
    adapter,
    'test',
    defaultConfig,
    'dev',
    inMemFS,
    import.meta.dirname,
    new Logger('error'),
)

const storage = inMemStorage({
    locales: ['en'],
    root: import.meta.dirname,
    sourceLocale: 'en',
    haveUrl: false,
    localesDir: 'src/locales',
    fs: inMemFS,
})

// needed to make sure generatedDir exists, normally done at hub init
await handler.init(new SharedState(storage, handler.key, 'en'))

test('HMR', async (t: TestContext) => {
    const content = ts`'Hello'`
    t.assert.strictEqual(
        trimLines((await handler.transform(content, 'test.js', 1))[0].code),
        trimLines(ts`
        import {getRuntime as _w_load_hmr_, getRuntimeRx as _w_load_rx_hmr_} from "./src/locales/test.loader.js"

        const _w_hmrUpdate_ = {"version":1,"data":{"en":[[0,"Hello"]]}}

        function _w_load_(loadID) {
            const _w_rt_ = _w_load_hmr_(loadID)
            _w_rt_?._?.update?.(_w_hmrUpdate_)
            return _w_rt_
        }

        function _w_load_rx_(loadID) {
            const _w_rt_ = _w_load_rx_hmr_(loadID)
            _w_rt_?._?.update?.(_w_hmrUpdate_)
            return _w_rt_
        }

        _w_load_('test')(0)
    `),
    )
    // not on SSR
    t.assert.strictEqual(
        trimLines((await handler.transform(content, 'test.js', 1, true))[0].code),
        trimLines(ts`
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "./src/locales/test.loader.js"
        _w_load_('test')(0)
    `),
    )
})

test('Manifest', async (t: TestContext) => {
    const manifestPath = resolve(import.meta.dirname, defaultConfig.localesDir, generatedDir, 'test.test.manifest.js')
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
    const [hmrKeys, updated] = await handler.handleMessages(msgs, 'foo.ts')
    t.assert.strictEqual(updated, true)
    t.assert.deepStrictEqual(hmrKeys, ['Hello'])
    // @ts-expect-error
    const msgs1 = [newMessage({ msgStr: ['Hello'], context: null })]
    const [, updated1] = await handler.handleMessages(msgs1, 'foo.ts')
    t.assert.strictEqual(updated1, false)
    const [, updated2] = await handler.handleMessages(msgs, 'bar.ts')
    t.assert.strictEqual(updated2, true)
})
