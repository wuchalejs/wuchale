// $ node --import '#test-resolve' %f

import { type TestContext, test } from 'node:test'
import { dummyTransform, trimLines, ts } from '#test-utils'
import { defaultArgs } from '../adapter-vanilla/index.js'
import { type Adapter } from '../adapters.js'
import { defaultConfig } from '../config.js'
import { Logger } from '../log.js'
import { AdapterHandler } from './index.js'
import { SharedStates } from './state.js'

const adapter: Adapter = {
    ...defaultArgs,
    transform: dummyTransform,
    files: '*.js', // filename needs to match
    localesDir: new URL('../../testing/tmp', import.meta.url).pathname,
    loaderExts: ['.js'],
    defaultLoaderPath: new URL('../adapter-vanilla/loaders/server.js', import.meta.url).pathname,
}

const handler = new AdapterHandler(adapter, 'test', defaultConfig, 'dev', import.meta.dirname, new Logger('error'))
await handler.init(new SharedStates())

test('HMR', async (t: TestContext) => {
    const content = ts`'Hello'`
    t.assert.strictEqual(
        trimLines((await handler.transform(content, 'test.js', 1)).code),
        trimLines(ts`
        import {getRuntime as _w_load_hmr_, getRuntimeRx as _w_load_rx_hmr_} from "../../testing/tmp/test.loader.js"

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
})
