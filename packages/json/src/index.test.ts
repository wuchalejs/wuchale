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
        mergeSameRegionals: false,
        removePluralRule: false,
        removePlaceholders: false,
        flattenTranslations: false,
        stringForSingle: false,
        haveUrl: true,
        sourceLocale: 'en',
        localesDir: 'src/locales',
        fs: inMemFS,
        parse: JSON.parse,
        stringify: JSON.stringify,
        extension: 'json',
    }),
    'JSONFile-1',
    'src/locales/catalog.url.json',
    true,
)

testStorage(
    new JSONFile({
        dir: 'src/locales',
        locales: ['en', 'es'],
        root: '/projects',
        mergeSameRegionals: true,
        removePluralRule: true,
        removePlaceholders: false,
        flattenTranslations: false,
        stringForSingle: false,
        haveUrl: true,
        sourceLocale: 'en',
        localesDir: 'src/locales',
        fs: inMemFS,
        parse: JSON.parse,
        stringify: JSON.stringify,
        extension: 'json',
    }),
    'JSONFile-2',
    'src/locales/catalog.url.json',
    true,
)

testStorage(
    new JSONFile({
        dir: 'src/locales',
        locales: ['en', 'es'],
        root: '/projects',
        mergeSameRegionals: true,
        removePluralRule: true,
        removePlaceholders: true,
        flattenTranslations: true,
        stringForSingle: false,
        haveUrl: true,
        sourceLocale: 'en',
        localesDir: 'src/locales',
        fs: inMemFS,
        parse: JSON.parse,
        stringify: JSON.stringify,
        extension: 'json',
    }),
    'JSONFile-3',
    'src/locales/catalog.url.json',
    true,
)

testStorage(
    new JSONFile({
        dir: 'src/locales',
        locales: ['en', 'es'],
        root: '/projects',
        mergeSameRegionals: true,
        removePluralRule: true,
        removePlaceholders: true,
        flattenTranslations: true,
        stringForSingle: true,
        haveUrl: true,
        sourceLocale: 'en',
        localesDir: 'src/locales',
        fs: inMemFS,
        parse: JSON.parse,
        stringify: JSON.stringify,
        extension: 'json',
    }),
    'JSONFile-4',
    'src/locales/catalog.url.json',
    true,
)
