import { copyFile, mkdir } from "node:fs/promises"
import { type Config } from "../config.js"
import { AdapterHandler } from "../handler.js"
import { dirname } from "node:path"
import { color, Logger } from "../log.js"
import { ask, setupInteractive } from "./input.js"
import { extractAdap } from "./extract.js"
import { promisify } from 'node:util'
import child_process from 'node:child_process'

type DepsTree = {
    dependencies?: {[name: string]: DepsTree}
    [prop: string]: any,
}

function gatherDeps(deps: DepsTree): Set<string> {
    const dependencies = new Set<string>()
    if (deps.dependencies == null) {
        return dependencies
    }
    for (const [key, val] of Object.entries(deps.dependencies)) {
        dependencies.add(key)
        for (const sub of gatherDeps(val)) {
            dependencies.add(sub)
        }
    }
    return dependencies
}

async function getDependencies() {
    const exec = promisify(child_process.exec)
    const output = await exec('npm list --json')
    const json = JSON.parse(output.stdout.toString().trim()) as DepsTree
    return gatherDeps(json)
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
            logger.log(`Loader already exists for ${color.cyan(key)} at ${color.cyan(loaderPath)}`)
            continue
        }
        if (!loaderPath) {
            loaderPath = handler.getLoaderPaths()[0]
        }
        logger.log(`Create loader for ${color.cyan(key)} at ${color.cyan(loaderPath)}`)
        await mkdir(dirname(loaderPath), { recursive: true })
        const loaders = await adapter.defaultLoaders(await getDependencies())
        const loader = await ask(loaders, `Select default loader for adapter: ${key}`)
        await copyFile(adapter.defaultLoaderPath(loader), loaderPath)
        logger.log(`Initial extract for ${color.cyan(key)}`)
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
