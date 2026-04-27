// $ node --import ../../testing/resolve.ts %f

import { type TestContext, test } from 'node:test'
// @ts-expect-error
import { dummyTransform, inMemFS, inMemStorage } from '../../testing/utils.ts'
import { defaultArgs } from '../adapter-vanilla/index.js'
import type { Adapter } from '../adapters.js'
import { Files } from './files.js'

const defaultLoaderPath = '/foo/bar/js'

inMemFS.write(defaultLoaderPath, 'foo')

const adapter: Adapter = {
    ...defaultArgs,
    transform: dummyTransform,
    files: '*.js', // filename needs to match
    storage: inMemStorage,
    loaderExts: ['.js'],
    defaultLoaderPath,
}

const files = await Files.create({
    adapter,
    key: 'foo',
    fs: inMemFS,
    root: '/proj',
    ownerKey: 'foo',
    localesDirAbs: '/proj/locales',
})

test('Files import path correct', (t: TestContext) => {
    t.assert.strictEqual(files.getImportPath('/proj/foo.js'), './foo.js')
    t.assert.strictEqual(files.getImportPath('/proj/.foo.js'), './.foo.js')
    t.assert.strictEqual(files.getImportPath('/proj/foo/bar.js', '/proj/bar/boo.js'), '../foo/bar.js')
})
