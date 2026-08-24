import { getConfig } from 'wuchale'
import { type PluginConf, wuchale as vitePlugin } from 'wuchale/vite'

type ConfigSetup = {
    command: string
    updateConfig: (...a: any[]) => any
}

export function wuchale(options: PluginConf = {}) {
    return {
        name: 'wuchale',
        hooks: {
            'astro:config:setup': async ({ command, updateConfig }: ConfigSetup) => {
                const conf = await getConfig(options.configPath)
                const plugin = vitePlugin(options)
                await plugin.config(null, { mode: command })
                await plugin.buildStart()
                updateConfig({
                    vite: {
                        plugins: [
                            {
                                name: plugin.name,
                                handleHotUpdate: plugin.handleHotUpdate,
                                transform: { order: 'pre' as 'pre', handler: plugin.transform },
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
