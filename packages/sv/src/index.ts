import { existsSync } from 'node:fs'
import path from 'node:path'
import { color, transforms } from '@sveltejs/sv-utils'
import { defineAddon, defineAddonOptions } from 'sv'
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
                    return `Your inputs ${list.format(invalidTags.map(x => `"${x}"`))} are not a valid BCP language tag`
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
    id: 'wuchale',
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

                        const handleNode = ast.body.some(node => {
                            if (node.type !== 'ExportNamedDeclaration') return undefined

                            if (node.declaration?.type === 'VariableDeclaration') {
                                return node.declaration.declarations.find((d: any) => d.id?.name === 'handle')
                            }

                            if (node.declaration?.type === 'FunctionDeclaration') {
                                return node.declaration.id.name === 'handle'
                            }

                            return undefined
                        }) as any

                        const handleName = handleNode ? 'i18n' : 'handle'
                        const sequenceNode = ast.body.find(node => {
                            if (node.type !== 'ExportNamedDeclaration') return false
                            if (node.declaration?.type === 'VariableDeclaration') {
                                return node.declaration?.declarations.some(
                                    (d: any) =>
                                        d.id?.name === 'handle' &&
                                        d.init?.type === 'CallExpression' &&
                                        d.init?.callee?.name === 'sequence',
                                )
                            }
                            return false
                        }) as any
                        js.common.appendFromString(ast, {
                            code: `
export const ${handleName}${isHooksFileTS ? ': Handle' : ''} = async ({ event, resolve }) => {
    const locale = event.url.searchParams.get('locale') ?? '${locales[0]}'
    return await runWithLocale(locale, () => resolve(event))
}`,
                        })
                        if (!sequenceNode && handleNode) {
                            js.imports.addNamed(ast, {
                                from: '@sveltejs/kit/hooks',
                                imports: ['sequence'],
                            })

                            js.common.appendFromString(ast, {
                                code: 'export const handle = sequence(handler, i18n)',
                            })
                        }

                        if (sequenceNode) {
                            const sequenceArgs = sequenceNode.declaration?.declarations?.[0]?.init.arguments
                            sequenceArgs.push({
                                type: 'Identifier',
                                name: 'i18n',
                                start: 0,
                                end: 0,
                            })
                        }
                        if (handleNode) {
                            if (handleNode.declaration?.type === 'VariableDeclaration') {
                                handleNode.declaration.declarations[0].id.name = 'handler'
                            } else if (handleNode.declaration?.type === 'FunctionDeclaration') {
                                handleNode.declaration.id.name = 'handler'
                            }

                            handleNode.type = handleNode.declaration.type
                            Object.assign(handleNode, handleNode.declaration)
                        }
                    }),
                )
                let layoutFile = ''

                if (existsSync(path.resolve('src/routes/+layout.ts'))) {
                    layoutFile = 'src/routes/+layout.ts'
                } else if (existsSync(path.resolve('src/routes/+layout.js'))) {
                    layoutFile = 'src/routes/+layout.js'
                } else {
                    layoutFile = `src/routes/+layout.${language}`
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

                        const loadNode = ast.body.find(node => {
                            if (node.type !== 'ExportNamedDeclaration') return undefined

                            if (node.declaration?.type === 'VariableDeclaration') {
                                return node.declaration.declarations.some((d: any) => d.id?.name === 'load')
                            }

                            return undefined
                        }) as any

                        if (!loadNode) {
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
                        } else {
                            const loadDeclaration = loadNode.declaration.declarations.find((node: any) => {
                                if (node.id.name === 'load') return node
                                return undefined
                            })

                            const loadParameters = loadDeclaration.init.params

                            if (!loadParameters || loadParameters.length === 0) {
                                loadParameters.push({
                                    type: 'ObjectPattern',
                                    properties: [],
                                })
                            }

                            let hasUrl: boolean = false
                            for (const param of loadParameters) {
                                for (const prop of param.properties) {
                                    if (prop.key.name === 'url') {
                                        hasUrl = true
                                        break
                                    }
                                }
                                if (hasUrl) break
                            }
                            const objectParameter = loadParameters.find((node: any) => {
                                if (node.type === 'ObjectPattern') return node
                                return undefined
                            })
                            if (!hasUrl) {
                                objectParameter.properties.push({
                                    type: 'Property',
                                    method: false,
                                    shorthand: true,
                                    computed: false,
                                    key: {
                                        type: 'Identifier',
                                        name: 'url',
                                    },
                                    value: {
                                        type: 'Identifier',
                                        name: 'url',
                                    },
                                    kind: 'init',
                                })
                            }

                            const block = loadDeclaration.init.body
                            js.common.appendFromString(block, {
                                code: `const locale = url.searchParams.get('locale') ?? '${locales[0]}'
    if (browser && locales.includes(locale ${isLayoutFileTS ? 'as Locale' : ''})) {
        await loadLocale(locale)
    }
`,
                            })
                        }
                    }),
                )
            } else {
                sv.file(
                    'src/App.svelte',
                    transforms.svelteScript({ language }, ({ ast, js, svelte, content }) => {
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

                        const nodes = ast.fragment.nodes

                        const existingHtml: string[] = []
                        for (const node of nodes) {
                            const element = content.slice(node.start, node.end)
                            existingHtml.push(element)
                        }
                        ast.fragment.nodes = []
                        svelte.addFragment(
                            ast,
                            `
{#await loadLocale(locale)}
	Loading translations...
{:then}
${existingHtml
    .join('')
    .split('\n')
    .map(line => `\t${line}`)
    .join('\n')}
{/await}`,
                        )
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

    nextSteps: () => {
        const steps = [
            `${color.success('Wuchale setup complete!')}`,
            `Run ${color.command('npx wuchale')} for initial extract`,
            `Visit the wuchale docs at ${color.website('https://wuchale.dev/')} for full configuration`,
        ]

        return steps
    },
})

const displayName = new Intl.DisplayNames(['en'], { type: 'language' })

function isValidTag(tag: string) {
    try {
        const name = displayName.of(tag)
        return name !== undefined && name !== tag
    } catch {
        return false
    }
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
