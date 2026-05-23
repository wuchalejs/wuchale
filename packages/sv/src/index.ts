import { defineAddon, defineAddonOptions } from 'sv'
import { transforms } from './sv-utils.js'
import wuchaleKitConfig from './templates/wuchaleKitConfig.js'
import wuchalePlainConfig from './templates/wuchalePlainConfig.js'

const options = defineAddonOptions()
    .add('languages', {
        question: 'Which languages do you want to support? (e.g. en,zh-TW)',
        type: 'string',
        default: 'en, es',
        validate: input => {
            if (!input) return

            const { invalidTags } = parseLanguageInput(input)

            if (invalidTags.length > 0) {
                if (invalidTags.length === 1) {
                    return `Your input "${invalidTags[0]}" is not a valid BCP language tag`
                } else {
                    const list = new Intl.ListFormat('en', {
                        style: 'long',
                        type: 'conjunction',
                    })
                    return `Your input "${list.format(invalidTags.map(x => `"${x}"`))}" is not a valid BCP language tag`
                }
            }
            return undefined
        },
    })
    .add('generation', {
        question: 'Generate example setup files? (loader, layout, hooks?)',
        type: 'boolean',
        default: true,
    })
    .build()

export default defineAddon({
    id: '@wuchale/sv',
    shortDescription: 'i18n',
    homepage: 'https://wuchale.dev/',
    options,

    run: ({ directory, sv, options, language, file, isKit }) => {
        sv.dependency('wuchale', 'latest')
        sv.dependency('@wuchale/svelte', 'latest')

        sv.file(
            file.viteConfig,
            transforms.script(({ ast, js }) => {
                const pluginName = 'wuchale'
                js.imports.addDefault(ast, { as: pluginName, from: 'wuchale/vite' })
                js.vite.addPlugin(ast, { code: `${pluginName}()`, mode: 'prepend' })
            }),
        )

        sv.file(
            'wuchale.config.js',
            transforms.text(() => {
                const { validTags } = parseLanguageInput(options.languages)
                const locales = []

                if (validTags.length === 0) {
                    locales.push('en', 'es')
                } else {
                    validTags.map(x => locales.push(x))
                }

                return isKit ? wuchaleKitConfig(locales) : wuchalePlainConfig(locales)
            }),
        )
    },
})

function isValidTag(tag: string): boolean {
    return RegExp(/^[a-zA-Z]{2,3}(-[-a-zA-Z0-9]{2,8})*$/).test(tag)
}

function parseLanguageInput(input: string) {
    const potencialTags = input
        .replace(/[,\s]/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map(tag => tag.toLowerCase())

    const validTags: string[] = []
    const invalidTags: string[] = []

    for (const tag of potencialTags) {
        if (isValidTag(tag)) validTags.push(tag)
        else invalidTags.push(tag)
    }

    return { invalidTags, validTags }
}
