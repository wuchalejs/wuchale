import { defineAddon, defineAddonOptions } from 'sv'
import { transforms } from './sv-utils.js'

const options = defineAddonOptions()
    .add('who', {
        question: 'To whom should the addon say hello?',
        type: 'string',
        default: '',
    })
    .build()

export default defineAddon({
    id: '@wuchale/sv',
    options,

    setup: ({ isKit, unsupported }) => {
        if (!isKit) unsupported('Requires SvelteKit')
    },

    run: ({ directory, sv, options, language }) => {
        sv.file(
            `${directory.lib}/@wuchale/sv/content.txt`,
            transforms.text(() => {
                return `This is a text file made by the Community Addon Template demo for the add-on: '@wuchale/sv'!`
            }),
        )

        sv.file(
            `${directory.lib}/@wuchale/sv/HelloComponent.svelte`,
            transforms.svelteScript({ language }, ({ ast, svelte, js }) => {
                js.imports.addDefault(ast.instance.content, {
                    as: 'content',
                    from: './content.txt?raw',
                })

                svelte.addFragment(ast, '<p>{content}</p>')
                svelte.addFragment(ast, `<h2>Hello ${options.who}!</h2>`)
            }),
        )

        sv.file(
            directory.kitRoutes + '/+page.svelte',
            transforms.svelteScript({ language }, ({ ast, svelte, js }) => {
                js.imports.addDefault(ast.instance.content, {
                    as: 'HelloComponent',
                    from: `$lib/@wuchale/sv/HelloComponent.svelte`,
                })

                svelte.addFragment(ast, '<HelloComponent />')
            }),
        )
    },
})
