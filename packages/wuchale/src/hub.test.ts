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
    client: '/loaders/loader.js',
    server: '/loaders/loader.server.js',
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

inMemFS.write(defaultLoaderPath.client, '')
inMemFS.write(defaultLoaderPath.server, '')
const hub = await Hub.create('dev', loadConfig, import.meta.dirname, 0, inMemFS)

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
    const hub = await Hub.create('build', loadConfig, import.meta.dirname, 0, inMemFS)
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

test('hub onFileChange compiles once per handler for catalog changes', async (t: TestContext) => {
    const writes: string[] = []
    const countingFS = {
        ...inMemFS,
        write(file: string, data: string) {
            writes.push(normalizeSep(resolve(file)))
            return inMemFS.write(file, data)
        },
    }
    countingFS.write(defaultLoaderPath.client, '')
    countingFS.write(defaultLoaderPath.server, '')

    const hub = await Hub.create(
        'dev',
        async () => ({
            ...defaultConfig,
            locales: ['en', 'fr'],
            adapters: {
                main: {
                    ...defaultArgs,
                    transform: dummyTransform,
                    files: 'src/*.js',
                    loaderExts: ['.js'],
                    defaultLoaderPath,
                },
            },
        }),
        import.meta.dirname,
        0,
        countingFS,
    )

    await hub.transform(code, file)
    writes.length = 0

    const po_fname = normalizeSep(resolve(import.meta.dirname, defaultConfig.localesDir, 'fr.po'))
    const res = await hub.onFileChange(po_fname, () => 'external catalog change')

    t.assert.strictEqual(res?.sourceTriggered, false)

    const compiled_writes = writes.filter(file => file.endsWith('.compiled.js'))

    t.assert.strictEqual(compiled_writes.length, 2)
    t.assert.deepStrictEqual(
        new Set(compiled_writes),
        new Set([
            normalizeSep(resolve(import.meta.dirname, defaultConfig.localesDir, generatedDir, 'main.main.en.compiled.js')),
            normalizeSep(resolve(import.meta.dirname, defaultConfig.localesDir, generatedDir, 'main.main.fr.compiled.js')),
        ]),
    )
})

test('hub transform with hmr', async (t: TestContext) => {
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
