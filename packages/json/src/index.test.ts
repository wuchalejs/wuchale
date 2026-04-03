// $ node --import ../../wuchale/testing/resolve.ts %f

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
        mode: 'minimal',
        haveUrl: true,
        sourceLocale: 'en',
        localesDir: 'src/locales',
        fs: inMemFS,
        parse: JSON.parse,
        stringify: JSON.stringify,
        extension: 'json',
    }),
    'JSONFile',
    'src/locales/catalog.url.json',
    true,
)
