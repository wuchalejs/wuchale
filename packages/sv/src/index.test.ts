import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const kinds = [
    {
        type: 'default',
        addArgs: 'languages:en,es,pl+generation:yes',
    },
    {
        type: 'no-generation',
        addArgs: 'languages:en,es+generation:no',
    },
    {
        type: 'single-language',
        addArgs: 'languages:en+generation:yes',
    },
    {
        type: 'wrong-locale',
        addArgs: 'languages:en,dasodksaodkasokdoaskdos,es+generation:no',
    },
]

const variants = ['svelte', 'svelte-kit']

for (const kind of kinds) {
    for (const variant of variants) {
        const isKit = variant.includes('kit')

        const testName = `@wuchale/sv ${kind.type} ${variant}`

        test(testName, { concurrency: true }, async () => {
            const cwd = path.resolve(process.cwd(), `tmp/${kind.type}-${variant}`)

            fs.mkdirSync(cwd, { recursive: true })

            const createCommand = isKit
                ? `npx sv create ${cwd} --types ts --template minimal --no-add-ons --no-install`
                : `npx create-vite@latest ./tmp/${kind.type}-${variant} --template svelte`

            execSync(createCommand, { stdio: 'ignore' })
            execSync(
                `npx sv add "file:${process.cwd()}=${
                    kind.addArgs
                }" --cwd ${cwd} --no-git-check --no-install --no-download-check`,
                {
                    cwd,
                    stdio: 'ignore',
                },
            )

            const wuchaleConfigPath = path.resolve(cwd, 'wuchale.config.js')

            assert.equal(fs.existsSync(wuchaleConfigPath), true)

            const wuchaleConfig = fs.readFileSync(wuchaleConfigPath, 'utf8')

            assert.match(wuchaleConfig, /en/)

            if (kind.type === 'default') {
                assert.match(wuchaleConfig, /es/)
            }

            if (kind.type === 'single-language') {
                assert.match(wuchaleConfig, /"en"/)

                assert.doesNotMatch(wuchaleConfig, /"es"/)
            }

            if (kind.type === 'wrong-locale') {
                assert.match(wuchaleConfig, /"es"/)

                assert.doesNotMatch(wuchaleConfig, /"dasodksaodkasokdoaskdos"/)
            }

            const viteConfigPath = fs.existsSync(path.resolve(cwd, 'vite.config.ts'))
                ? path.resolve(cwd, 'vite.config.ts')
                : path.resolve(cwd, 'vite.config.js')

            const viteConfig = fs.readFileSync(viteConfigPath, 'utf8')

            assert.match(viteConfig, /wuchale/)

            const gitignore = fs.readFileSync(
                path.resolve(cwd, '.gitignore'),

                'utf8',
            )

            assert.match(gitignore, /\.wuchale/)

            if (isKit && kind.type !== 'no-generation' && kind.type !== 'wrong-locale') {
                const hooksPath = fs.existsSync(path.resolve(cwd, 'src/hooks.server.ts'))
                    ? path.resolve(cwd, 'src/hooks.server.ts')
                    : path.resolve(cwd, 'src/hooks.server.js')

                const hooks = fs.readFileSync(hooksPath, 'utf8')

                assert.match(hooks, /runWithLocale/)

                assert.match(hooks, /loadLocales/)

                assert.match(hooks, /handle/)

                const layoutPath = fs.existsSync(path.resolve(cwd, 'src/routes/+layout.ts'))
                    ? path.resolve(cwd, 'src/routes/+layout.ts')
                    : path.resolve(cwd, 'src/routes/+layout.js')

                const layout = fs.readFileSync(layoutPath, 'utf8')

                assert.match(layout, /loadLocale/)

                assert.match(layout, /browser/)

                assert.match(layout, /load/)
            }

            if (!isKit && kind.type !== 'no-generation' && kind.type !== 'wrong-locale') {
                const app = fs.readFileSync(
                    path.resolve(cwd, 'src/App.svelte'),

                    'utf8',
                )

                assert.match(app, /loadLocale/)

                assert.match(app, /locale/)
            }

            if (kind.type === 'no-generation') {
                assert.equal(fs.existsSync(path.resolve(cwd, 'src/hooks.server.js')), false)

                assert.equal(fs.existsSync(path.resolve(cwd, 'src/hooks.server.ts')), false)
            }
        })
    }
}
