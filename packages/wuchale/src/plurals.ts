import { resolve } from 'node:path'
import { loaderPathResolver } from './adapter-utils/index.js'
import type { FS } from './fs.js'

const pluralFileName = 'plural.js'

const pluralCategOrder: Intl.LDMLPluralRule[] = ['zero', 'one', 'two', 'few', 'many', 'other']

export const pluralTemplPath = loaderPathResolver(import.meta.url, '../src', 'js')('plural-tmpl')

export async function writePluralsFile(fs: FS, localesDirAbs: string, defaultLocale: string) {
    const pluralTempl = await fs.read(pluralTemplPath)
    if (!pluralTempl) {
        throw new Error('Plural template not found')
    }
    const pluralFileContent = pluralTempl
        .replaceAll('${DATA}', './data.js')
        .replaceAll('${LOCALE}', defaultLocale)
        .replace('ALL_C = []', `ALL_C = ['${pluralCategOrder.join("', '")}']`)
    await fs.write(resolve(localesDirAbs, pluralFileName), pluralFileContent)
}

export function orderedPluralForms(locale: string) {
    if (Intl.PluralRules.supportedLocalesOf([locale]).length === 0) {
        // unsupported locale
        return []
    }
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
    categories.sort((c1, c2) => pluralCategOrder.indexOf(c1) - pluralCategOrder.indexOf(c2))
    return categories
}
