// $ node --import ../../testing/resolve.ts %f

import { resolve } from 'node:path'
import { type TestContext, test } from 'node:test'
// @ts-expect-error
import { dummyTransform, trimLines, ts } from '../../testing/utils.ts'
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
    localesDir: resolve(import.meta.dirname, '../../testing/tmp'),
    loaderExts: ['.js'],
    defaultLoaderPath: resolve(import.meta.dirname, '../adapter-vanilla/loaders/server.js'),
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

test('transform error includes adapter and file context', async (t: TestContext) => {
    const badAdapter: Adapter = {
        ...adapter,
        transform: () => {
            const e = new Error('boom')
            ;(e as any).frame = '1: <svelte:window />\n   ^'
            throw e
        },
    }
    const badHandler = new AdapterHandler(
        badAdapter,
        'bad',
        defaultConfig,
        'dev',
        import.meta.dirname,
        new Logger('error'),
    )
    await badHandler.init(new SharedStates())

    await t.assert.rejects(
        () => badHandler.transform(ts`'Hello'`, 'test.js'),
        (err: any) => {
            t.assert.ok(err instanceof Error)
            t.assert.ok(err.message.startsWith('bad: transform failed for test.js\nboom'))
            t.assert.ok(err.message.includes('<svelte:window />'))
            return true
        },
    )
})
