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

    run: ({ sv, options, language, file, isKit }) => {
        sv.dependency('wuchale', 'latest')
        sv.dependency('@wuchale/svelte', 'latest')

        sv.file(
            file.viteConfig,
            transforms.script(({ ast, js }) => {
                const pluginName = 'wuchale'
                js.imports.addNamed(ast, {
                    imports: [pluginName],
                    from: 'wuchale/vite',
                })
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
                    validTags.map(tag => locales.push(tag))
                }

                return isKit ? wuchaleKitConfig(locales) : wuchalePlainConfig(locales)
            }),
        )

        if (options.generation) {
            if (isKit) {
                sv.file(
                    `src/hooks.server.${language === 'ts' ? 'ts' : 'js'}`,
                    transforms.script(({ ast, js }) => {
                        js.imports.addDefault(ast, {
                            as: '* as main',
                            from: './locales/main.loader.server.svelte.js',
                        })
                        js.imports.addDefault(ast, {
                            as: '* as js',
                            from: './locales/js.loader.server.js',
                        })
                        js.imports.addNamed(ast, {
                            from: 'wuchale/load-utils/server',
                            imports: ['runWithLocale, loadLocales'],
                        })
                        js.imports.addNamed(ast, {
                            imports: ['locales'],
                            from: './locales/data.js',
                        })

                        js.common.appendFromString(ast, {
                            code: 'loadLocales(main.key, main.loadIDs, main.loadCatalog, locales)',
                        })
                        js.common.appendFromString(ast, {
                            code: 'loadLocales(js.key, js.loadIDs, js.loadCatalog, locales)',
                        })

                        js.common.appendFromString(ast, {
                            code: `
	      export const handle = async ({ event, resolve }) => {
    		const locale = event.url.searchParams.get('locale') ?? 'en'
    		return await runWithLocale(locale, () => resolve(event))
	      }`,
                        })
                    }),
                )

                sv.file(
                    `src/routes/+layout.${language === 'ts' ? 'ts' : 'js'}`,
                    transforms.script(({ ast, js }) => {
                        js.imports.addNamed(ast, {
                            from: '../locales/data.js',
                            imports: ['locales'],
                        })
                        js.imports.addNamed(ast, {
                            from: '$app/environment',
                            imports: ['browser'],
                        })
                        js.imports.addNamed(ast, {
                            from: 'wuchale/load-utils',
                            imports: ['loadLocale'],
                        })
                        js.imports.addEmpty(ast, {
                            from: '../locales/main.loader.svelte.js',
                        })
                        js.imports.addEmpty(ast, {
                            from: '../locales/js.loader.js',
                        })

                        js.common.appendFromString(ast, {
                            code: `
export const load = async ({url}) => {
    const locale = url.searchParams.get('locale') ?? 'en'
    if (browser && locales.includes(locale)) {
        await loadLocale(locale)
    }
}
		    `,
                        })
                    }),
                )
            } else {
                sv.file(
                    'src/App.svelte',
                    transforms.svelteScript({ language }, ({ ast, svelte, js, content }) => {
                        js.imports.addNamed(ast.instance.content, {
                            from: 'wuchale/load-utils',
                            imports: ['loadLocale'],
                        })
                        js.imports.addEmpty(ast.instance.content, {
                            from: './locales/main.loader.svelte.js',
                        })

                        js.common.appendFromString(ast.instance.content, {
                            code: "let locale = $state('en')",
                        })

                        svelte.addFragment(
                            ast,
                            `{#await loadLocale(locale)}
    <!-- @wc-ignore -->
    Loading translations...
{:then}
    <!-- Move your existing app content here -->
{/await}`,
                            { mode: 'prepend', language },
                        )
                    }),
                )
            }
        }
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
