import fs from 'node:fs'
import path from 'node:path'
import { createSetupTest } from 'sv/testing'
import * as vitest from 'vitest'
import addon from './../src/index.js'

const { test, testCases } = createSetupTest(vitest)(
    { addon },
    {
        kinds: [
            {
                type: 'default',
                options: {
                    '@wuchale/sv': { languages: 'en, es', generation: true },
                },
            },
            {
                type: 'no-generation',
                options: {
                    '@wuchale/sv': { languages: 'en, es', generation: false },
                },
            },
            {
                type: 'single-language',
                options: {
                    '@wuchale/sv': { languages: 'en', generation: true },
                },
            },
            {
                type: 'wrong-locale',
                options: {
                    '@wuchale/sv': {
                        languages: 'en, dasodksaodkasokdoaskdos, es',
                        generation: false,
                    },
                },
            },
        ],
        browser: false,
    },
)

test.concurrent.for(testCases)('@wuchale/sv $kind.type $variant', async (testCase, ctx) => {
    const cwd = ctx.cwd(testCase)
    const isKit = testCase.variant.includes('kit')

    const wuchaleConfigPath = path.resolve(cwd, 'wuchale.config.js')
    vitest.expect(fs.existsSync(wuchaleConfigPath)).toBe(true)
    const wuchaleConfig = fs.readFileSync(wuchaleConfigPath, 'utf8')
    vitest.expect(wuchaleConfig).toContain('en')

    if (testCase.kind.type === 'default') {
        vitest.expect(wuchaleConfig).toContain('es')
    }

    if (testCase.kind.type === 'single-language') {
        vitest.expect(wuchaleConfig).toContain('"en"')
        vitest.expect(wuchaleConfig).not.toContain('"es"')
    }

    if (testCase.kind.type === 'wrong-locale') {
        vitest.expect(wuchaleConfig).toContain('"es"')
        vitest.expect(wuchaleConfig).not.toContain('"wrong"')
    }
    const viteConfigPath = fs.existsSync(path.resolve(cwd, 'vite.config.ts'))
        ? path.resolve(cwd, 'vite.config.ts')
        : path.resolve(cwd, 'vite.config.js')
    const viteConfig = fs.readFileSync(viteConfigPath, 'utf8')
    vitest.expect(viteConfig).toContain('wuchale')

    const gitignore = fs.readFileSync(path.resolve(cwd, '.gitignore'), 'utf8')
    vitest.expect(gitignore).toContain('.wuchale')

    if (isKit && testCase.kind.type !== 'no-generation' && testCase.kind.type !== 'wrong-locale') {
        const hooksPath = fs.existsSync(path.resolve(cwd, 'src/hooks.server.ts'))
            ? path.resolve(cwd, 'src/hooks.server.ts')
            : path.resolve(cwd, 'src/hooks.server.js')
        const hooks = fs.readFileSync(hooksPath, 'utf8')
        vitest.expect(hooks).toContain('runWithLocale')
        vitest.expect(hooks).toContain('loadLocales')
        vitest.expect(hooks).toContain('handle')

        const layoutPath = fs.existsSync(path.resolve(cwd, 'src/routes/+layout.ts'))
            ? path.resolve(cwd, 'src/routes/+layout.ts')
            : path.resolve(cwd, 'src/routes/+layout.js')
        const layout = fs.readFileSync(layoutPath, 'utf8')
        vitest.expect(layout).toContain('loadLocale')
        vitest.expect(layout).toContain('browser')
        vitest.expect(layout).toContain('load')
    }

    if (!isKit && testCase.kind.type !== 'no-generation' && testCase.kind.type !== 'wrong-locale') {
        const app = fs.readFileSync(path.resolve(cwd, 'src/App.svelte'), 'utf8')
        vitest.expect(app).toContain('loadLocale')
        vitest.expect(app).toContain('locale')
        vitest.expect(app).toContain('@wc-ignore')
    }

    if (testCase.kind.type === 'no-generation') {
        vitest.expect(fs.existsSync(path.resolve(cwd, 'src/hooks.server.js'))).toBe(false)
        vitest.expect(fs.existsSync(path.resolve(cwd, 'src/hooks.server.ts'))).toBe(false)
    }
})
