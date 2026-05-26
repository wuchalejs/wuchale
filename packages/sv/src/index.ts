import { existsSync } from 'node:fs'
import path from 'node:path'
import { defineAddon, defineAddonOptions } from 'sv'
import { color, transforms } from './sv-utils.js'
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
        question: `Generate and inject example setup files? (layout, hooks.server?)`,
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
        const { validTags } = parseLanguageInput(options.languages)
        const locales: string[] = []

        if (validTags.length === 0) {
            locales.push('en', 'es')
        } else {
            locales.push(...validTags)
        }
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
            transforms.text(({ content }) => {
                if (content) return false

                return isKit ? wuchaleKitConfig(locales) : wuchalePlainConfig(locales)
            }),
        )

        if (options.generation) {
            if (isKit) {
                const hooksFile = existsSync(path.resolve('src/hooks.server.ts'))
                    ? 'src/hooks.server.ts'
                    : existsSync('src/hooks.server.js')
                      ? 'src/hooks.server.js'
                      : `src/hooks.server.${language}`
                sv.file(
                    hooksFile,
                    transforms.script(({ ast, js }) => {
                        js.imports.addNamespace(ast, {
                            as: 'main',
                            from: './locales/main.loader.server.svelte.js',
                        })
                        js.imports.addNamespace(ast, {
                            as: 'js',
                            from: './locales/js.loader.server.js',
                        })
                        js.imports.addNamed(ast, {
                            from: 'wuchale/load-utils/server',
                            imports: ['runWithLocale', 'loadLocales'],
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
    		const locale = event.url.searchParams.get('locale') ?? '${locales[0]}'
    		return await runWithLocale(locale, () => resolve(event))
	      }`,
                        })
                    }),
                )

                const layoutFile = existsSync(path.resolve('src/routes/+layout.ts'))
                    ? 'src/routes/+layout.ts'
                    : existsSync('src/routes/+layout.js')
                      ? 'src/routes/+layout.js'
                      : `src/routes/+layout.${language}`
                sv.file(
                    layoutFile,
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
    const locale = url.searchParams.get('locale') ?? '${locales[0]}'
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
                    transforms.svelteScript({ language }, ({ ast, svelte, js }) => {
                        js.imports.addNamed(ast.instance.content, {
                            from: 'wuchale/load-utils',
                            imports: ['loadLocale'],
                        })
                        js.imports.addEmpty(ast.instance.content, {
                            from: './locales/main.loader.svelte.js',
                        })

                        js.common.appendFromString(ast.instance.content, {
                            code: `let locale = $state('${locales[0]}')`,
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

        sv.file(
            file.gitignore,
            transforms.text(({ content, text }) => {
                if (!content) return false

                return text.upsert(content, '.wuchale', {
                    comment: 'Wuchale autogenerated dir',
                })
            }),
        )
    },

    nextSteps: ({ isKit, options }) => {
        const steps = [
            `${color.success('Wuchale setup complete!')}`,
            `Run ${color.command('npx wuchale')} for initial extract`,
            `Visit the wuchale docs at ${color.website('https://wuchale.dev/')} for full configuration`,
            `Optionally you can set up AI translation in ${color.path('wuchale.config.js')}`,
        ]

        if (!isKit && options.generation) {
            steps.push(
                color.optional(
                    `In ${color.path('App.svelte')} file move your content into specified point or delete unnecessary.`,
                ),
            )
        }

        return steps
    },
})

function isValidTag(tag: string): boolean {
    return RegExp(/^[a-zA-Z]{2,3}(-[-a-zA-Z0-9]{2,8})*$/).test(tag)
}

function parseLanguageInput(input: string) {
    const potentialTags = input
        .replace(/[,\s]/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map(tag => tag.toLowerCase())

    const validTags: string[] = []
    const invalidTags: string[] = []

    for (const tag of potentialTags) {
        if (isValidTag(tag)) validTags.push(tag)
        else invalidTags.push(tag)
    }

    return { invalidTags, validTags }
}
