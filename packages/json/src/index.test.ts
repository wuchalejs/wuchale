// $ node --import ../../wuchale/testing/resolve.ts %f

import { test } from 'node:test'
// @ts-expect-error
import { testStorage } from '../../wuchale/src/pofile.test.ts'
// @ts-expect-error
import { inMemFS } from '../../wuchale/testing/utils.ts'
import { JSONFile } from './index.js'

testStorage(
    new JSONFile({
        dir: 'src/locales',
        locales: ['en', 'es'],
        root: '/projects',
        haveUrl: true,
        sourceLocale: 'en',
        fs: inMemFS,
        parse: JSON.parse,
        stringify: JSON.stringify,
        extension: 'json',
    }),
)
