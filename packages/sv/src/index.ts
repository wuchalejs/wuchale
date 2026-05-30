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

// conditions for warnings in nextSteps
let hooksFileExisted = true
let layoutFileExisted = true

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
                let hooksFile = ''

                if (existsSync(path.resolve('src/hooks.server.ts'))) {
                    hooksFile = 'src/hooks.server.ts'
                } else if (existsSync(path.resolve('src/hooks.server.js'))) {
                    hooksFile = 'src/hooks.server.js'
                } else {
                    hooksFile = `src/hooks.server.${language}`
                    hooksFileExisted = false
                }
                const isHooksFileTS = hooksFile.endsWith('ts')
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

                        if (isHooksFileTS) {
                            js.imports.addNamed(ast, {
                                imports: ['Handle'],
                                from: '@sveltejs/kit',
                                isType: true,
                            })
                        }

                        js.common.appendFromString(ast, {
                            code: `
	      export const handle${isHooksFileTS ? ': Handle' : ''} = async ({ event, resolve }) => {
    		const locale = event.url.searchParams.get('locale') ?? '${locales[0]}'
    		return await runWithLocale(locale, () => resolve(event))
	      }`,
                        })
                    }),
                )
                let layoutFile = ''

                if (existsSync(path.resolve('src/routes/+layout.ts'))) {
                    layoutFile = 'src/routes/+layout.ts'
                } else if (existsSync(path.resolve('src/routes/+layout.js'))) {
                    layoutFile = 'src/routes/+layout.js'
                } else {
                    layoutFile = `src/routes/+layout.${language}`
                    layoutFileExisted = false
                }
                const isLayoutFileTS = layoutFile.endsWith('ts')
                sv.file(
                    layoutFile,
                    transforms.script(({ ast, js }) => {
                        const dataImports = ['locales']
                        if (isLayoutFileTS) {
                            dataImports.push('type Locale')
                        }
                        js.imports.addNamed(ast, {
                            from: '../locales/data.js',
                            imports: dataImports,
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
                        if (isLayoutFileTS) {
                            js.imports.addNamed(ast, {
                                imports: ['LayoutLoad'],
                                from: './$types',
                                isType: true,
                            })
                        }

                        js.common.appendFromString(ast, {
                            code: `
export const load${isLayoutFileTS ? ': LayoutLoad' : ''} = async ({url}) => {
    const locale = url.searchParams.get('locale') ?? '${locales[0]}'
    if (browser && locales.includes(locale ${isLayoutFileTS ? 'as Locale' : ''})) {
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
                    transforms.svelteScript({ language }, ({ ast, js }) => {
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
                    }),
                )
            }
        }

        sv.file(
            file.gitignore,
            transforms.text(({ content, text }) => {
                if (!content) return false

                return text.upsert(content, '.wuchale')
            }),
        )
    },

    nextSteps: ({ isKit, options }) => {
        const steps = [
            `${color.success('Wuchale setup complete!')}`,
            `Run ${color.command('npx wuchale')} for initial extract`,
            `Visit the wuchale docs at ${color.website('https://wuchale.dev/')} for full configuration`,
        ]

        if (hooksFileExisted && options.generation) {
            steps.push(
                color.warning(
                    `WARNING! File ${color.path(
                        'hooks.server',
                    )} existed before, so you might need to fix your handlers using ${color.command(
                        'sequence',
                    )} (${color.website('https://svelte.dev/docs/kit/@sveltejs-kit-hooks#sequence')})`,
                ),
            )
        }

        if (layoutFileExisted && options.generation) {
            steps.push(
                color.warning(
                    `WARNING! File ${color.path('+layout')} existed before, so you might need to fix ${color.command(
                        'load',
                    )} function by moving its content`,
                ),
            )
        }
        if (!isKit && options.generation) {
            steps.push(
                `In ${color.path('App.svelte')} file move your content into like this: 
				${color.dim(`
	{#await loadLocale(locale)}
    		Loading translations...
	{:then}
    		<!-- Move your existing app content here -->
	{/await}`)}`,
            )
        }

        return steps
    },
})

// Original regex is located here: https://github.com/opral/monorepo/blob/94c2298cc1da5378b908e4c160b0fa71a45caadb/inlang/source-code/versioned-interfaces/language-tag/src/interface.ts#L16
function isValidTag(tag: string): boolean {
    return /^((?<grandfathered>(en-GB-oed|i-ami|i-bnn|i-default|i-enochian|i-hak|i-klingon|i-lux|i-mingo|i-navajo|i-pwn|i-tao|i-tay|i-tsu|sgn-BE-FR|sgn-BE-NL|sgn-CH-DE)|(art-lojban|cel-gaulish|no-bok|no-nyn|zh-guoyu|zh-hakka|zh-min|zh-min-nan|zh-xiang))|((?<language>([A-Za-z]{2,3}(-(?<extlang>[A-Za-z]{3}(-[A-Za-z]{3}){0,2}))?))(-(?<script>[A-Za-z]{4}))?(-(?<region>[A-Za-z]{2}|[0-9]{3}))?(-(?<variant>[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*))$/.test(
        tag,
    )
}

function parseLanguageInput(input: string) {
    const potentialTags = input.replace(/[,\s]/g, ' ').split(' ').filter(Boolean)

    const validTags: string[] = []
    const invalidTags: string[] = []

    for (const tag of potentialTags) {
        if (isValidTag(tag)) validTags.push(tag)
        else invalidTags.push(tag)
    }

    return { invalidTags, validTags }
}
