// $ node --import ../../wuchale/testing/resolve.ts %f

// @ts-expect-error
import { testStorage } from '../../wuchale/src/pofile.test.ts'
// @ts-expect-error
import { inMemFS } from '../../wuchale/testing/utils.ts'
import { JSONFile } from './index.js'

testStorage(
    new JSONFile({
        location: 'src/locales/catalog.json',
        locales: ['en', 'es'],
        root: '/projects',
        mergeSameRegionals: false,
        removePlaceholders: false,
        flattenTranslations: false,
        sourceLocale: 'en',
        localesDir: 'src/locales',
        fs: inMemFS,
        parse: JSON.parse,
        stringify: JSON.stringify,
    }),
    'JSONFile-1',
    true,
)

testStorage(
    new JSONFile({
        location: 'src/locales/catalog.json',
        locales: ['en', 'es'],
        root: '/projects',
        mergeSameRegionals: true,
        removePlaceholders: false,
        flattenTranslations: false,
        sourceLocale: 'en',
        localesDir: 'src/locales',
        fs: inMemFS,
        parse: JSON.parse,
        stringify: JSON.stringify,
    }),
    'JSONFile-2',
    true,
)

testStorage(
    new JSONFile({
        location: 'src/locales/catalog.json',
        locales: ['en', 'es'],
        root: '/projects',
        mergeSameRegionals: true,
        removePlaceholders: true,
        flattenTranslations: true,
        sourceLocale: 'en',
        localesDir: 'src/locales',
        fs: inMemFS,
        parse: JSON.parse,
        stringify: JSON.stringify,
    }),
    'JSONFile-3',
    true,
)

testStorage(
    new JSONFile({
        location: 'src/locales/catalog.json',
        locales: ['en', 'es'],
        root: '/projects',
        mergeSameRegionals: true,
        removePlaceholders: true,
        flattenTranslations: true,
        sourceLocale: 'en',
        localesDir: 'src/locales',
        fs: inMemFS,
        parse: JSON.parse,
        stringify: JSON.stringify,
    }),
    'JSONFile-4',
    true,
)
