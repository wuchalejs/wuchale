// $$ node --import ../testing/resolve.ts %f

import { resolve } from 'node:path'
import { type TestContext, test } from 'node:test'
import { type Config, defaultConfig, normalizeSep, pofile } from 'wuchale'
import { defaultArgs } from 'wuchale/adapter-vanilla'
// @ts-expect-error
import { dummyTransform, inMemFS, trimLines, ts } from '../../wuchale/testing/utils.ts'
import { Hub } from './hub.js'

const file = normalizeSep(resolve(import.meta.dirname, 'foo.js')) // needs to match files, relative to root

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

const hub = new Hub(loadConfig, import.meta.dirname, 0, inMemFS)

test('hub init', async () => {
    await hub.init('dev')
})

test('hub transform basic', async (t: TestContext) => {
    const [output] = await hub.transform(code, file)
    t.assert.strictEqual(
        trimLines(output.code),
        trimLines(ts`
            import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../tmp/main.loader.js"
            _w_load_('main')(0)
        `),
    )
})

test('hub transform ssr', async (t: TestContext) => {
    await hub.init('build')
    const [output] = await hub.transform(code, file, true)
    t.assert.strictEqual(
        trimLines(output.code),
        trimLines(ts`
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "../tmp/main.loader.server.js"
        _w_load_('main')(0)
    `),
    )
})

test('hub onFileChange', async (t: TestContext) => {
    const res1 = await hub.onFileChange(file, () => '')
    t.assert.strictEqual(res1, undefined)
    const poFname = normalizeSep(resolve(tmpDir, 'en.po'))
    const res2 = await hub.onFileChange(poFname, () => '')
    t.assert.deepEqual(res2?.sourceTriggered, false)
    t.assert.partialDeepStrictEqual(
        new Set([normalizeSep(resolve(import.meta.dirname, '../tmp/.wuchale/main.main.en.compiled.js'))]),
        res2?.invalidate,
    )
})

test('hub transform with hmr', async (t: TestContext) => {
    await hub.init('dev')
    const [output] = await hub.transform(code, file)
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
