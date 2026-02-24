// $ node --import ../../testing/resolve.ts %f

import { resolve } from 'node:path'
import { type TestContext, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
// @ts-expect-error
import { dummyTransform, trimLines, ts } from '../../testing/utils.ts'
import { defaultArgs } from '../adapter-vanilla/index.js'
import { Message, type Adapter } from '../adapters.js'
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

test('remove stale file references when messages are removed from a file', async (t: TestContext) => {
    const locales_dir = await mkdtemp(`${tmpdir()}/wuchale-po-`)
    const local_adapter: Adapter = {
        ...adapter,
        localesDir: locales_dir,
        transform: ({ content, expr, index }) => {
            const msg = 'Hello'
            const msgs = content.includes(msg) ? [new Message(msg)] : []
            return {
                msgs,
                output: header => ({
                    code: `${header}\n${msgs.length ? `${expr.plain}(${index.get(msg)})` : ''}`,
                    map: [],
                }),
            }
        },
    }
    const local_handler = new AdapterHandler(
        local_adapter,
        'test_ref_cleanup',
        { ...defaultConfig, ai: null },
        'dev',
        import.meta.dirname,
        new Logger('error'),
    )
    await local_handler.init(new SharedStates())
    const filename = 'stale_ref.js'
    const key = new Message('Hello').toKey()
    try {
        await local_handler.transform(`'Hello'`, filename, 1)
        const po_file = local_handler.sharedState.poFilesByLoc.get('en')!
        const item_before = po_file.catalog.get(key)!
        t.assert.strictEqual(item_before.references.some(r => r.file === filename), true)

        await local_handler.transform(`''`, filename, 2)
        const item_after = po_file.catalog.get(key)!
        t.assert.strictEqual(item_after.references.some(r => r.file === filename), false)
    } finally {
        await rm(locales_dir, { recursive: true, force: true })
    }
})
