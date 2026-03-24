// $$ node --import ../testing/resolve.ts %f

import { resolve } from 'node:path'
import { type TestContext, test } from 'node:test'
import { type Config, defaultConfig, generatedDir, normalizeSep } from 'wuchale'
import { defaultArgs } from 'wuchale/adapter-vanilla'
// @ts-expect-error
import { dummyTransform, inMemFS, trimLines, ts } from '../../wuchale/testing/utils.ts'
import { Hub } from './hub.js'

const file = resolve(import.meta.dirname, 'src/foo.js') // needs to match files, relative to root

const code = ts`
    function foo() {
        return 'Hello'
    }
`

const defaultLoaderPath = {
    client: 'loader.js',
    server: 'loader.server.js',
}

const loadConfig = async (): Promise<Config> => ({
    ...defaultConfig,
    adapters: {
        main: {
            ...defaultArgs,
            transform: dummyTransform,
            files: 'src/*.js', // filename needs to match
            loaderExts: ['.js'],
            defaultLoaderPath,
        },
    },
})

const hub = new Hub(loadConfig, import.meta.dirname, 0, inMemFS)

test('hub init', async () => {
    inMemFS.write(defaultLoaderPath.client, '')
    inMemFS.write(defaultLoaderPath.server, '')
    await hub.init('dev')
})

test('hub transform basic', async (t: TestContext) => {
    const [output] = await hub.transform(code, file)
    t.assert.strictEqual(
        trimLines(output.code),
        trimLines(ts`
            import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "./locales/main.loader.js"
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
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "./locales/main.loader.server.js"
        _w_load_('main')(0)
    `),
    )
})

test('hub onFileChange', async (t: TestContext) => {
    const res1 = await hub.onFileChange(file, () => '')
    t.assert.strictEqual(res1, undefined)
    const poFname = normalizeSep(resolve(import.meta.dirname, defaultConfig.localesDir, 'en.po'))
    const res2 = await hub.onFileChange(poFname, () => '')
    t.assert.deepEqual(res2?.sourceTriggered, false)
    t.assert.partialDeepStrictEqual(
        new Set([
            normalizeSep(
                resolve(import.meta.dirname, defaultConfig.localesDir, generatedDir, 'main.main.en.compiled.js'),
            ),
        ]),
        res2?.invalidate,
    )
})

test('hub transform with hmr', async (t: TestContext) => {
    await hub.init('dev')
    const [output] = await hub.transform(code, file)
    t.assert.strictEqual(
        trimLines(output.code),
        trimLines(ts`
        import {getRuntime as _w_load_hmr_, getRuntimeRx as _w_load_rx_hmr_} from "./locales/main.loader.js"
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
