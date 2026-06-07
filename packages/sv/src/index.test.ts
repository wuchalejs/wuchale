import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { add, create } from 'sv'
import addon from './index.js'

const kinds = [
    {
        type: 'default',
        options: { languages: 'en, es, pl', generation: true },
    },
    {
        type: 'no-generation',
        options: { languages: 'en, es', generation: false },
    },
    {
        type: 'single-language',
        options: { languages: 'en', generation: true },
    },
    {
        type: 'wrong-locale',
        options: { languages: 'en, dasodksaodkasokdoaskdos, es', generation: false },
    },
    {
        type: 'existing-layout-no-url',
        options: { languages: 'en, es', generation: true },
        kitOnly: true,
        setup: (cwd: string) => {
            fs.writeFileSync(
                path.resolve(cwd, 'src/routes/+layout.ts'),
                `export const load = async ({ cookies }) => { return {} }\n`,
            )
        },
    },
    {
        type: 'existing-layout-with-url',
        options: { languages: 'en, es', generation: true },
        kitOnly: true,
        setup: (cwd: string) => {
            fs.writeFileSync(
                path.resolve(cwd, 'src/routes/+layout.ts'),
                `export const load = async ({ url, cookies }) => { return {} }\n`,
            )
        },
    },
    {
        type: 'existing-layout-empty-params',
        options: { languages: 'en, es', generation: true },
        kitOnly: true,
        setup: (cwd: string) => {
            fs.writeFileSync(
                path.resolve(cwd, 'src/routes/+layout.ts'),
                `export const load = async ({}) => { return {} }\n`,
            )
        },
    },
    {
        type: 'existing-hooks-sequence',
        options: { languages: 'en, es', generation: true },
        kitOnly: true,
        setup: (cwd: string) => {
            fs.writeFileSync(
                path.resolve(cwd, 'src/hooks.server.ts'),
                `import { sequence } from '@sveltejs/kit/hooks'
const first = async ({ event, resolve }) => resolve(event)
const second = async ({ event, resolve }) => resolve(event)
export const handle = sequence(first, second)\n`,
            )
        },
    },
    {
        type: 'existing-layout-with-content',
        options: { languages: 'en, es', generation: true },
        kitOnly: true,
        setup: (cwd: string) => {
            fs.writeFileSync(
                path.resolve(cwd, 'src/routes/+layout.ts'),
                `export const load = async ({ url }) => {
    const theme = url.searchParams.get('theme') ?? 'light'
    return { theme }
}\n`,
            )
        },
    },
]

const variants = ['svelte', 'svelte-kit']

for (const kind of kinds) {
    for (const variant of variants) {
        const isKit = variant.includes('kit')

        if (kind.kitOnly && !isKit) continue

        const testName = `@wuchale/sv ${kind.type} ${variant}`

        test(testName, { concurrency: true }, async () => {
            const cwd = path.resolve(process.cwd(), `tmp/${kind.type}-${variant}`)

            fs.mkdirSync(cwd, { recursive: true })

            create({
                cwd,
                name: `${kind.type}-${variant}`,
                types: 'typescript',
                template: isKit ? 'minimal' : 'svelte',
            })

            if (kind.setup) {
                kind.setup(cwd)
            }

            await add({
                addons: { wuchale: addon },
                cwd,
                options: { wuchale: kind.options },
                packageManager: 'npm',
            })

            assert.equal(fs.existsSync(path.resolve(cwd, 'wuchale.config.js')), true)
            const wuchaleConfig = fs.readFileSync(path.resolve(cwd, 'wuchale.config.js'), 'utf8')
            assert.match(wuchaleConfig, /\ben\b/)

            if (kind.type === 'default') {
                assert.match(wuchaleConfig, /\bes\b/)
            }
            if (kind.type === 'single-language') {
                assert.match(wuchaleConfig, /\ben\b/)
                assert.doesNotMatch(wuchaleConfig, /\bes\b/)
            }
            if (kind.type === 'wrong-locale') {
                assert.match(wuchaleConfig, /\bes\b/)
                assert.doesNotMatch(wuchaleConfig, /\bdasodksaodkasokdoaskdos\b/)
            }

            const viteConfig = fs.readFileSync(path.resolve(cwd, 'vite.config.ts'), 'utf8')
            assert.match(viteConfig, /wuchale/)

            const gitignore = fs.readFileSync(path.resolve(cwd, '.gitignore'), 'utf8')
            assert.match(gitignore, /\.wuchale/)

            if (isKit && kind.type !== 'no-generation' && kind.type !== 'wrong-locale') {
                const hooks = fs.readFileSync(path.resolve(cwd, 'src/hooks.server.ts'), 'utf8')
                assert.match(hooks, /runWithLocale/)
                assert.match(hooks, /loadLocales/)
                assert.match(hooks, /handle/)

                const layout = fs.readFileSync(path.resolve(cwd, 'src/routes/+layout.ts'), 'utf8')
                assert.match(layout, /loadLocale/)
                assert.match(layout, /browser/)
                assert.match(layout, /load/)
            }

            if (!isKit && kind.type !== 'no-generation' && kind.type !== 'wrong-locale') {
                const app = fs.readFileSync(path.resolve(cwd, 'src/App.svelte'), 'utf8')
                assert.match(app, /loadLocale/)
                assert.match(app, /locale/)
            }

            if (kind.type === 'no-generation') {
                assert.equal(fs.existsSync(path.resolve(cwd, 'src/hooks.server.js')), false)
                assert.equal(fs.existsSync(path.resolve(cwd, 'src/hooks.server.ts')), false)
            }

            if (isKit && kind.type === 'existing-layout-no-url') {
                const layout = fs.readFileSync(path.resolve(cwd, 'src/routes/+layout.ts'), 'utf8')
                assert.match(layout, /url/)
                assert.match(layout, /searchParams/)
                assert.match(layout, /loadLocale/)
                assert.match(layout, /cookies/)
                assert.match(layout, /load:\s*LayoutLoad/)
            }

            if (isKit && kind.type === 'existing-layout-with-url') {
                const layout = fs.readFileSync(path.resolve(cwd, 'src/routes/+layout.ts'), 'utf8')
                assert.match(layout, /url/)
                assert.match(layout, /searchParams/)
                assert.match(layout, /cookies/)
                assert.match(layout, /load:\s*LayoutLoad/)
                assert.equal((layout.match(/\burl\b/g) ?? []).length <= 3, true)
            }

            if (isKit && kind.type === 'existing-layout-empty-params') {
                const layout = fs.readFileSync(path.resolve(cwd, 'src/routes/+layout.ts'), 'utf8')
                assert.match(layout, /url/)
                assert.match(layout, /searchParams/)
                assert.match(layout, /loadLocale/)
                assert.match(layout, /load:\s*LayoutLoad/)
            }

            if (isKit && kind.type === 'existing-hooks-sequence') {
                const hooks = fs.readFileSync(path.resolve(cwd, 'src/hooks.server.ts'), 'utf8')
                assert.match(hooks, /sequence/)
                assert.match(hooks, /i18n/)
                assert.match(hooks, /first/)
                assert.match(hooks, /second/)
                assert.equal((hooks.match(/sequence/g) ?? []).length, 2)
                assert.ok(hooks.indexOf('i18n') < hooks.indexOf('sequence('))
            }

            if (isKit && kind.type === 'existing-layout-with-content') {
                const layout = fs.readFileSync(path.resolve(cwd, 'src/routes/+layout.ts'), 'utf8')
                assert.match(layout, /theme/)
                assert.match(layout, /light/)
                assert.match(layout, /loadLocale/)
                assert.match(layout, /searchParams/)
                assert.match(layout, /load:\s*LayoutLoad/)
            }
        })
    }
}
