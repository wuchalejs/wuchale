// $$ node --import ../../wuchale/testing/resolve.ts %f

import { resolve } from 'node:path'
import { type TestContext, test } from 'node:test'
import { rm } from 'fs/promises'
import { type Config, defaultConfig, normalizeSep, pofile } from 'wuchale'
import { defaultArgs } from 'wuchale/adapter-vanilla'
// @ts-expect-error
import { dummyTransform, trimLines, ts } from '../../wuchale/testing/utils.ts'
import { toViteError, Wuchale } from './index.js'

const file = resolve(import.meta.dirname, 'foo.js') // needs to match files, relative to root

const code = ts`
    function foo() {
        return 'Hello'
    }
`

const tmpDir = resolve(import.meta.dirname, '../tmp')

const defaultLoader = resolve(import.meta.dirname, '../../wuchale/src/adapter-vanilla/loaders/server.js')

const loadConfig = async (): Promise<Config> => ({
    ...defaultConfig,
    localesDir: tmpDir,
    adapters: {
        main: {
            ...defaultArgs,
            storage: pofile({ dir: tmpDir }),
            transform: dummyTransform,
            files: '*.js', // filename needs to match
            loaderExts: ['.js'],
            defaultLoaderPath: {
                client: defaultLoader,
                server: defaultLoader,
            },
        },
    },
})

const plugin = new Wuchale(loadConfig, import.meta.dirname, 0)

test('configResolved', async () => {
    try {
        await rm(tmpDir, { recursive: true })
    } catch {}
    await plugin.configResolved({ env: { DEV: true } })
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
    await plugin.configResolved({ env: { DEV: false } })
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
    ctx.file = normalizeSep(resolve(tmpDir, 'en.po'))
    const res2 = await plugin.handleHotUpdate(ctx)
    t.assert.deepEqual(res2, [])
    t.assert.deepEqual(wsMsg!, { type: 'full-reload' })
    t.assert.partialDeepStrictEqual(
        { id: normalizeSep(resolve(import.meta.dirname, '../tmp/.wuchale/main.main.en.compiled.js')) },
        invalidatedModule!,
    )
    t.assert.deepEqual(invalidatedModules!, new Set())
    t.assert.strictEqual(timeStamp!, 1001)
    t.assert.strictEqual(reLoad!, false)
})

test('transform with hmr', async (t: TestContext) => {
    await plugin.configResolved({ env: { DEV: true } })
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

test('error correctly formatted', async (t: TestContext) => {
    const e = new Error('boom')
    ;(e as any).frame = '1: <svelte:window />\n   ^'
    t.assert.throws(
        () => toViteError(e, 'bad', 'test.js'),
        (err: any) => {
            t.assert.ok(err instanceof Error)
            t.assert.ok(err.message.startsWith('bad: transform failed for test.js\nboom'))
            t.assert.ok(err.message.includes('<svelte:window />'))
            return true
        },
    )
})
