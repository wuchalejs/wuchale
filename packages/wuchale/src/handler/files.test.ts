// $ node --import ../../testing/resolve.ts %f

import { resolve } from 'node:path'
import { type TestContext, test } from 'node:test'
import type { Adapter } from '../adapters.js'
import { type FS } from '../fs.js'
import { Files, generatedDir } from './files.js'

function createFS() {
    const files = new Map<string, string>()
    const fs = {
        write: (file: string, data: string) => {
            files.set(file, data)
        },
        read: (file: string) => files.get(file) ?? '',
        mkdir: () => {},
        exists: (file: string) => files.has(file),
        unlink: (file: string) => {
            files.delete(file)
        },
    } as FS
    return { files, fs }
}

test('writeUrlFiles removes stale generated helpers', async (t: TestContext) => {
    const { files, fs } = createFS()
    const filesHandler = new Files(
        { loaderExts: ['.js'], defaultLoaderPath: '' } as Adapter,
        'test',
        '/project/src/locales',
        fs,
        '/project',
    )
    await filesHandler.init('test')

    const manifestPath = resolve('/project/src/locales', generatedDir, 'test.urls.js')
    const helperPath = resolve('/project/src/locales', 'test.url.js')

    await filesHandler.writeUrlFiles([['/items', ['/items', '/elementos']]], 'en')
    t.assert.strictEqual(files.has(manifestPath), true)
    t.assert.strictEqual(files.has(helperPath), true)

    await filesHandler.writeUrlFiles([], 'en')
    t.assert.strictEqual(files.has(manifestPath), false)
    t.assert.strictEqual(files.has(helperPath), false)
})
