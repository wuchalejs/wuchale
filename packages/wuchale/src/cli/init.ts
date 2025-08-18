import { copyFile, mkdir } from "node:fs/promises"
import { type Config } from "../config.js"
import { AdapterHandler, type SharedStates } from "../handler.js"
import { dirname } from "node:path"
import { color, Logger } from "../log.js"
import { ask, setupInteractive } from "./input.js"
import { extractAdap } from "./extract.js"

export async function init(config: Config, locales: string[], logger: Logger) {
    logger.info('Initializing...')
    let extractedNew = false
    setupInteractive()
    const adapLogger = new Logger(config.messages)
    const sharedState: SharedStates = {}
    const keysByLoaderPath: Record<string, string> = {}
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const adapterName = color.magenta(key)
        const handler = new AdapterHandler(adapter, key, config, 'extract', 'extract', process.cwd(), adapLogger)
        let {path: loaderPath, empty} = await handler.getLoaderPath()
        const loaders = await adapter.defaultLoaders()
        let existing = false
        if (loaderPath) {
            if (!empty) {
                loaders.unshift('existing')
                existing = true
            }
        } else {
            loaderPath = handler.getLoaderPaths()[0]
        }
        logger.log(`${existing ? 'Edit' : 'Create'} loader for ${adapterName} at ${color.cyan(loaderPath)}`)
        await mkdir(dirname(loaderPath), { recursive: true })
        let loader = loaders[0]
        if (loaders.length > 1) {
            loader = await ask(loaders, `Select default loader for adapter: ${adapterName}`, logger)
        }
        if (existing && loader === loaders[0]) {
            logger.log('Keep existing loader')
            continue
        }
        await copyFile(adapter.defaultLoaderPath(loader), loaderPath)
        logger.log(`Initial extract for ${adapterName}`)
        await extractAdap(handler, sharedState, adapter.files, locales, false, logger)
        if (handler.loaderPath in keysByLoaderPath) {
            throw new Error([
                'While catalogs can be shared, the same loader cannot be used by multiple adapters',
                `Conflicting: ${adapterName} and ${color.cyan(keysByLoaderPath[handler.loaderPath])}`,
                'Specify a different loaderPath for one of them.'
            ].join('\n'))
        } else {
            keysByLoaderPath[handler.loaderPath] = key
        }
        extractedNew = true
        logger.log(`\n${adapterName}: Read more at ${color.cyan(adapter.docsUrl)}.`)
    }
    const msgs = ['\nInitialization complete!\n']
    msgs.push(
        'Next steps:',
        '1. Finish the setup for each adapter following its docs URL above.',
        '2. Start the dev server and you\'re good to go!',
    )
    if (config.geminiAPIKey === 'env') {
        msgs.push(
            '\n(Optional):',
            `  Set the ${color.cyan('GEMINI_API_KEY')} environment variable before starting the server`,
            '  to enable live translation!',
            `\nYou can always run ${color.cyan('npx wuchale')}`
        )
    }
    logger.log(msgs.join('\n'))
}
