// $$ node --import ../../wuchale/testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
import { rm } from 'fs/promises'
import { resolve } from 'path'
import { type Config, defaultConfig, normalizeSep } from 'wuchale'
import { defaultArgs } from 'wuchale/adapter-vanilla'
// @ts-expect-error
import { dummyTransform, trimLines, ts } from '../../wuchale/testing/utils.ts'
import { Wuchale } from './index.js'

const file = new URL('foo.js', import.meta.url).pathname // needs to match files, relative to root

const code = ts`
    function foo() {
        return 'Hello'
    }
`

const tmpDir = new URL('../tmp', import.meta.url).pathname

const defaultLoader = new URL('../../wuchale/src/adapter-vanilla/loaders/server.js', import.meta.url).pathname

const loadConfig = async (): Promise<Config> => ({
    ...defaultConfig,
    adapters: {
        main: {
            ...defaultArgs,
            transform: dummyTransform,
            files: '*.js', // filename needs to match
            localesDir: tmpDir,
            loaderExts: ['.js'],
            defaultLoaderPath: {
                client: defaultLoader,
                server: defaultLoader,
            },
        },
    },
})

const plugin = new Wuchale(loadConfig, 0)

test('configResolved', async () => {
    try {
        await rm(tmpDir, { recursive: true })
    } catch {}
    await plugin.configResolved({ env: { DEV: true }, root: import.meta.dirname })
})

test('transform basic', async (t: TestContext) => {
    const output = await plugin.transform.handler(code, file)
    t.assert.strictEqual(
        trimLines(output.code),
        trimLines(ts`
            import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../tmp/main.loader.js"
            _w_load_('main')(0)
        `),
    )
})

test('transform ssr', async (t: TestContext) => {
    await plugin.configResolved({ env: { DEV: false }, root: import.meta.dirname })
    const output = await plugin.transform.handler(code, file, { ssr: true })
    t.assert.strictEqual(
        trimLines(output.code),
        trimLines(ts`
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../tmp/main.loader.server.js"
        _w_load_('main')(0)
    `),
    )
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
                },
            },
            moduleGraph: {
                getModulesByFile: (fileId: string) => [{ id: fileId }],
                invalidateModule: (
                    module: object,
                    invalidateModules: Set<object>,
                    timestamp: number,
                    reload: boolean,
                ) => {
                    invalidatedModule = module
                    invalidatedModules = invalidateModules
                    timeStamp = timestamp
                    reLoad = reload
                },
            },
        },
        read: () => fileContents,
        timestamp: 1001,
    }
    const res1 = await plugin.handleHotUpdate(ctx)
    t.assert.strictEqual(res1, undefined)
    t.assert.strictEqual(invalidatedModule!, undefined)
    ctx.file = `${tmpDir}/en.po`
    const res2 = await plugin.handleHotUpdate(ctx)
    t.assert.deepEqual(res2, [])
    t.assert.deepEqual(wsMsg!, { type: 'full-reload' })
    t.assert.partialDeepStrictEqual(
        { id: normalizeSep(resolve(new URL('../tmp/.wuchale/main.main.en.compiled.js', import.meta.url).pathname)) },
        invalidatedModule!,
    )
    t.assert.deepEqual(invalidatedModules!, new Set())
    t.assert.strictEqual(timeStamp!, 1001)
    t.assert.strictEqual(reLoad!, false)
})

test('transform with hmr', async (t: TestContext) => {
    await plugin.configResolved({ env: { DEV: true }, root: import.meta.dirname })
    const output = await plugin.transform.handler(code, file)
    t.assert.strictEqual(
        trimLines(output.code),
        trimLines(ts`
        import {getRuntime as _w_load_hmr_, getRuntimeRx as _w_load_rx_hmr_} from "../tmp/main.loader.js"
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
        _w_load_('main')(0)
    `),
    )
})
