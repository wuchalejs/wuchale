// $$ cd .. && npm run test

import { test, type TestContext } from 'node:test'
import { wuchale } from '../dist/index.js'
import { rm } from 'fs/promises'
// @ts-expect-error
import { trimLines, ts } from '../../wuchale/tests/check.ts'
import { resolve } from 'path'

const plugin = wuchale('./tests/wuchale.config.js', 0)

const file = 'tests/foo.test.js'
const code = ts`
    function foo() {
        return 'Hello'
    }
`

test('configResolved', async () => {
    try {
        await rm('./test-tmp', { recursive: true })
    } catch {}
    await plugin.configResolved({ env: { DEV: true }, root: '.' })
})

test('transform basic', async (t: TestContext) => {
    const output = await plugin.transform.handler(code, file)
    t.assert.strictEqual(trimLines(output.code ?? '') ?? '', trimLines(ts`
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "./test-tmp/main.loader.js"
        function foo() {
            const _w_runtime_ = _w_load_('main')
            return _w_runtime_(0)
        }
    `))
})

test('transform ssr', async (t: TestContext) => {
    await plugin.configResolved({ env: { DEV: false }, root: '.' })
    const output = await plugin.transform.handler(code, file, {ssr: true})
    t.assert.strictEqual(trimLines(output.code ?? '') ?? '', trimLines(ts`
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "./test-tmp/main.loader.server.js"
        function foo() {
            const _w_runtime_ = _w_load_('main')
            return _w_runtime_(0)
        }
    `))
})

test('handleHotUpdate', async (t: TestContext) => {
    let wsMsg: object
    let invalidatedModule: object
    let invalidatedModules: Set<object>
    let timeStamp: number
    let reLoad: boolean
    let fileContents = ''
    const ctx: Parameters<typeof plugin.handleHotUpdate>[0] = {
        file,
        server: {
            ws: {
                send: (msg: object) => {
                    wsMsg = msg
                }
            },
            moduleGraph: {
                getModulesByFile: (fileId: string) => [{id: fileId}],
                invalidateModule: (module: object, invalidateModules: Set<object>, timestamp: number, reload: boolean) => {
                    invalidatedModule = module
                    invalidatedModules = invalidateModules
                    timeStamp = timestamp
                    reLoad = reload
                }
            }
        },
        read: () => fileContents,
        timestamp: 1001,
    }
    const res1 = await plugin.handleHotUpdate(ctx)
    t.assert.strictEqual(res1, undefined)
    t.assert.strictEqual(invalidatedModule!, undefined)
    ctx.file = 'tests/test-tmp/en.po'
    const res2 = await plugin.handleHotUpdate(ctx)
    t.assert.deepEqual(res2, [])
    t.assert.deepEqual(wsMsg!, {type: 'full-reload'})
    t.assert.partialDeepStrictEqual({id: resolve('tests/test-tmp/.wuchale/main.main.en.compiled.js')}, invalidatedModule!)
    t.assert.deepEqual(invalidatedModules!, new Set())
    t.assert.strictEqual(timeStamp!, 1001)
    t.assert.strictEqual(reLoad!, false)
})

test('transform with hmr', async (t: TestContext) => {
    await plugin.configResolved({ env: { DEV: true }, root: '.' })
    const output = await plugin.transform.handler(code, file)
    t.assert.strictEqual(trimLines(output.code ?? '') ?? '', trimLines(ts`
        import {getRuntime as _w_load_hmr_, getRuntimeRx as _w_load_rx_hmr_} from "./test-tmp/main.loader.js"
        const _w_hmrUpdate_ = {"version":0,"data":{"en":[[0,"Hello"]]}}
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
        function foo() {
            const _w_runtime_ = _w_load_('main')
            return _w_runtime_(0)
        }
    `))
})
