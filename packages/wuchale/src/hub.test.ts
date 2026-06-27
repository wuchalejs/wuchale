// $$ node --import ../testing/resolve.ts %f

import { resolve } from 'node:path'
import { type TestContext, test } from 'node:test'
// @ts-expect-error
import { dummyTransform, inMemFS, trimLines, ts } from '../../wuchale/testing/utils.ts'
import { defaultArgs } from './adapter-vanilla/index.js'
import { type Config, type DevMode, defaultConfig } from './config.js'
import { generatedDir, normalizeSep } from './handler/files.js'
import { devPidFile, Hub } from './hub.js'

const file = resolve(import.meta.dirname, 'src/foo.js') // needs to match files, relative to root

const code = ts`
    function foo() {
        return 'Hello'
    }
`

const transformedCodeDefault = ts`
    import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "./locales/main.loader.js"
    _w_load_()(0)
`

const defaultLoaderPath = {
    client: '/loaders/loader.js',
    server: '/loaders/loader.server.js',
}

let devMode: DevMode = 'refs'

const devPidPath = resolve(import.meta.dirname, defaultConfig.localesDir, generatedDir, devPidFile)

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
    dev: devMode,
})

inMemFS.write(defaultLoaderPath.client, '')
inMemFS.write(defaultLoaderPath.server, '')
const hub = await Hub.create('dev', loadConfig, import.meta.dirname, [], 0, inMemFS)

test('hub transform basic', async (t: TestContext) => {
    const [output] = await hub.transform(code, file)
    t.assert.strictEqual(trimLines(output.code), trimLines(transformedCodeDefault))
})

test('hub transform ssr', async (t: TestContext) => {
    await inMemFS.unlink(devPidPath)
    const hub = await Hub.create('build', loadConfig, import.meta.dirname, [], 0, inMemFS)
    const [output] = await hub.transform(code, file, true)
    t.assert.strictEqual(
        trimLines(output.code),
        trimLines(ts`
        import {getRuntime as _w_load_, getRuntimeRx as _w_load_rx_} from "./locales/main.loader.server.js"
        _w_load_()(0)
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
            normalizeSep(resolve(import.meta.dirname, defaultConfig.localesDir, generatedDir, 'main.0.en.compiled.js')),
        ]),
        res2?.invalidate,
    )
})

test('hub transform with hmr', async (t: TestContext) => {
    const [output] = await hub.transform(code, file)
    t.assert.strictEqual(
        trimLines(output.code),
        trimLines(ts`
        import {getRuntime as _w_load_hmr_, getRuntimeRx as _w_load_rx_hmr_} from "./locales/main.loader.js"
        import {updated as _w_updated_} from "wuchale/dev"
        const [_w_load_, _w_load_rx_] = _w_updated_(_w_load_hmr_, _w_load_rx_hmr_, {"en":[[0,"Hello"]]})
        _w_load_()(0)
    `),
    )
})

test('different dev modes', async (t: TestContext) => {
    const po = resolve(import.meta.dirname, 'src/locales/en.po')

    await inMemFS.unlink(devPidPath)
    await inMemFS.unlink(po)
    devMode = false
    let hub = await Hub.create('dev', loadConfig, import.meta.dirname, [], 0, inMemFS)
    const [output] = await hub.transform(code, file)
    t.assert.strictEqual(await inMemFS.read(po), null)
    t.assert.deepStrictEqual(output, {})

    // existing po
    await inMemFS.unlink(devPidPath)
    devMode = 'add'
    hub = await Hub.create('dev', loadConfig, import.meta.dirname, [], 0, inMemFS)
    await hub.transform(code, file)
    await hub.transform(ts`const x = () => 'Hello1'`, file)
    let poContent = (await inMemFS.read(po)) ?? ''
    t.assert.match(poContent, /\nmsgid "Hello"/)
    t.assert.match(poContent, /\nmsgid "Hello1"/)

    // existing po
    await inMemFS.unlink(devPidPath)
    devMode = 'read'
    hub = await Hub.create('dev', loadConfig, import.meta.dirname, [], 0, inMemFS)
    await hub.transform(ts`const x = () => 'Hello2'`, file)
    poContent = (await inMemFS.read(po)) ?? ''
    t.assert.match(poContent, /"Hello"/)
    t.assert.match(poContent, /"Hello1"/)
    t.assert.doesNotMatch(poContent, /"Hello2"/)

    await inMemFS.unlink(devPidPath)
    await inMemFS.unlink(po)
    devMode = 'refs'
    hub = await Hub.create('dev', loadConfig, import.meta.dirname, [], 0, inMemFS)
    await hub.transform(code, file)
    await hub.transform(ts`const x = () => 'Hello1'`, file)
    poContent = (await inMemFS.read(po)) ?? ''
    t.assert.match(poContent, /\n#~ msgid "Hello"/) // obsolete
    t.assert.match(poContent, /\nmsgid "Hello1"/) // new

    // existing po
    await inMemFS.unlink(devPidPath)
    devMode = 'clean'
    hub = await Hub.create('dev', loadConfig, import.meta.dirname, [], 0, inMemFS)
    await hub.transform(code, file)
    poContent = (await inMemFS.read(po)) ?? ''
    t.assert.match(poContent, /"Hello"/)
    t.assert.doesNotMatch(poContent, /"Hello1"/)
})
