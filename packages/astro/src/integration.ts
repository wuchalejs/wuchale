import { dirname } from 'node:path'
import { getConfig, Hub } from 'wuchale'
import {
    defaultTrimParams,
    type PluginConf,
    toViteError,
    trimViteQueries,
    type wuchale as vitePlugin,
} from 'wuchale/vite'

type ConfigSetup = {
    command: string
    updateConfig: (...a: any[]) => any
}

export function wuchale({ configPath, hmrDelayThreshold = 1000, trimQueryParams }: PluginConf = {}) {
    const trimParams = new Set([...(trimQueryParams ?? []), ...defaultTrimParams])
    return {
        name: 'wuchale',
        hooks: {
            'astro:config:setup': async ({ command, updateConfig }: ConfigSetup) => {
                const conf = await getConfig(configPath)
                const hub = await Hub.create(
                    command === 'dev' ? 'dev' : 'build',
                    conf,
                    dirname(configPath ?? '.'),
                    [],
                    hmrDelayThreshold,
                    undefined,
                    toViteError,
                )
                updateConfig({
                    vite: {
                        plugins: [
                            {
                                transform: {
                                    order: 'pre',
                                    async handler(code, id, options) {
                                        const [output] = await hub.transform(
                                            code,
                                            trimViteQueries(id, trimParams),
                                            options?.ssr,
                                        )
                                        return output
                                    },
                                } satisfies { order: 'pre'; handler: ReturnType<typeof vitePlugin>['transform'] },
                            },
                        ],
                    },
                    i18n: {
                        locales: conf.locales,
                        defaultLocale: conf.locales[0],
                        routing: {
                            prefixDefaultLocale: true,
                            redirectToDefaultLocale: true,
                        },
                    },
                })
            },
        },
    }
}
