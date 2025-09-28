import { copyFile, mkdir } from "node:fs/promises"
import { type Config } from "../config.js"
import { AdapterHandler, type SharedStates } from "../handler.js"
import { dirname } from "node:path"
import { color, Logger } from "../log.js"
import { ask, setupInteractive } from "./input.js"
import { extractAdap } from "./extract.js"
import type { LoaderPath } from "../adapters.js"
import { defaultGemini } from "../ai/gemini.js"

export async function init(config: Config, locales: string[]) {
    console.info('Initializing...')
    let extractedNew = false
    setupInteractive()
    const adapLogger = new Logger(config.logLevel)
    const sharedState: SharedStates = {}
    const keysByLoaderPath: Record<string, string> = {}
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const adapterName = color.magenta(key)
        const handler = new AdapterHandler(adapter, key, config, 'extract', 'extract', process.cwd(), adapLogger)
        let {path: loaderPath, empty} = await handler.getLoaderPath()
        const loaders = await adapter.defaultLoaders()
        let existing = false
        if (loaderPath) {
            if (!Object.values(empty).some(side => side)) { // all non empty
                loaders.unshift('existing')
                existing = true
            }
        } else {
            loaderPath = handler.getLoaderPaths()[0]
        }
        console.info(`${existing ? 'Edit' : 'Create'} loader for ${adapterName}`)
        let loader = loaders[0]
        if (loaders.length > 1) {
            loader = await ask(loaders, `Select default loader for adapter: ${adapterName}`)
        }
        if (existing && loader === loaders[0]) {
            console.info('Keep existing loader')
            continue
        }
        const defaultLoader = adapter.defaultLoaderPath(loader)
        const defaultPaths: LoaderPath = typeof defaultLoader === 'string' ? {
            client: defaultLoader,
            ssr: defaultLoader,
        } : defaultLoader
        for (const [side, fromPath] of Object.entries(defaultPaths)) {
            const toPath = loaderPath[side]
            await mkdir(dirname(toPath), { recursive: true })
            await copyFile(fromPath, toPath)
            keysByLoaderPath[toPath] = key
        }
        console.info(`Initial extract for ${adapterName}`)
        await extractAdap(handler, sharedState, adapter.files, locales, false, false)
        extractedNew = true
        console.info(`\n${adapterName}: Read more at ${color.cyan(adapter.docsUrl)}.`)
    }
    const msgs = ['\nInitialization complete!\n']
    msgs.push(
        'Next steps:',
        '1. Finish the setup for each adapter following its docs URL above.',
        '2. Start the dev server and you\'re good to go!',
    )
    if (config.ai === defaultGemini) {
        msgs.push(
            '\n(Optional):',
            `  Set the ${color.cyan('GEMINI_API_KEY')} environment variable before starting the server`,
            '  to enable live translation!',
            `\nYou can always run ${color.cyan('npx wuchale')}`
        )
    }
    console.info(msgs.join('\n'))
}
