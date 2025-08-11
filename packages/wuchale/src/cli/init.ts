import { copyFile, readFile, mkdir } from "node:fs/promises"
import { type Config } from "../config.js"
import { AdapterHandler } from "../handler.js"
import { dirname } from "node:path"
import { color, Logger } from "../log.js"
import { ask, setupInteractive } from "./input.js"
import { extractAdap } from "./extract.js"

async function getDependencies() {
    let json = { devDependencies: {}, dependencies: {} }
    try {
        const pkgJson = await readFile('package.json')
        json = JSON.parse(pkgJson.toString())
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err
        }
    }
    return new Set(Object.keys({ ...json.devDependencies, ...json.dependencies }))
}

export async function init(config: Config, locales: string[], logger: Logger) {
    logger.info('Initializing...')
    let extractedNew = false
    setupInteractive()
    const adapLogger = new Logger(config.messages)
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'extract', 'extract', process.cwd(), adapLogger)
        let {path: loaderPath, empty} = await handler.getLoaderPath()
        if (loaderPath && !empty) {
            logger.log(`Loader already exists for ${color.magenta(key)} at ${color.cyan(loaderPath)}`)
            continue
        }
        if (!loaderPath) {
            loaderPath = handler.getLoaderPaths()[0]
        }
        logger.log(`Create loader for ${color.magenta(key)} at ${color.cyan(loaderPath)}`)
        await mkdir(dirname(loaderPath), { recursive: true })
        const loaders = await adapter.defaultLoaders(await getDependencies())
        let loader = loaders[0]
        if (loaders.length > 1) {
            loader = await ask(loaders, `Select default loader for adapter: ${color.magenta(key)}`, logger)
        }
        await copyFile(adapter.defaultLoaderPath(loader), loaderPath)
        logger.log(`Initial extract for ${color.magenta(key)}`)
        await extractAdap(handler, adapter.files, locales, false, logger)
        extractedNew = true
    }
    const msgs = ['\nInitialization complete!\n']
    if (extractedNew) {
        msgs.push('Extracted current messages from your codebase.\n')
    }
    msgs.push(
        'Next steps:',
        '1. Edit the file that sets the current locale.',
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
