#!/usr/bin/env node

import { copyFile, mkdir } from "node:fs/promises"
import { configName, getConfig } from "../config.js"
import { AdapterHandler } from "../handler.js"
import { parseArgs } from 'node:util'
import { dirname } from "node:path"
import { color, Logger } from "../log.js"
import { ask, setupInteractive } from "./input.js"

const { positionals, values } = parseArgs({
    options: {
        config: {
            type: 'string',
        },
        clean: {
            type: 'boolean',
            short: 'c',
        },
        help: {
            type: 'boolean',
            short: 'h',
        }
    },
    allowPositionals: true,
})

const cmd = positionals[0]

const help = `
Usage:
    ${color.cyan('wuchale [command] {options}')}

Commands:
    ${color.grey('[none]')}  Extract/compile messages from the codebase into catalogs
            deleting unused messages if ${color.cyan('--clean')} is specified
    ${color.cyan('init')}    Initialize on a codebase
    ${color.cyan('status')}  Show current status

Options:
    ${color.cyan('--config')}     use another config file instead of ${color.cyan(configName)}
    ${color.cyan('--clean')}, ${color.cyan('-c')}  (only when no commands) remove unused messages from catalogs
    ${color.cyan('--help')}, ${color.cyan('-h')}   Show this help
`

async function extract(handler: AdapterHandler, locales: string[]) {
    await handler.init()
    if (values.clean) {
        for (const loc of locales) {
            for (const item of Object.values(handler.catalogs[loc])) {
                item.references = []
            }
        }
    }
    await handler.directExtract()
    if (values.clean) {
        logger.log('Cleaning...')
        for (const loc of locales) {
            for (const [key, item] of Object.entries(handler.catalogs[loc])) {
                if (item.references.length === 0) {
                    delete handler.catalogs[loc][key]
                }
            }
            await handler.savePoAndCompile(loc)
        }
    }
}

const logger = new Logger(true)

if (values.help) {
    logger.log('wuchale cli')
    logger.log(help.trimEnd())
} else if (cmd == null) {
    logger.info('Extracting...')
    const config = await getConfig(values.config)
    const locales = Object.keys(config.locales)
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'extract', 'extract', process.cwd(), new Logger(config.messages))
        await extract(handler, locales)
    }
    logger.info('Extraction finished.')
} else if (cmd === 'init') {
    logger.info('Initializing...')
    const config = await getConfig(values.config)
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
        const loaders = await adapter.defaultLoaders()
        const loader = await ask(loaders, `Select default loader for adapter: ${key}`)
        await copyFile(adapter.defaultLoaderPath(loader), loaderPath)
        logger.log(`Initial extract for ${color.cyan(key)}`)
        await extract(handler, Object.keys(config.locales))
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
} else if (cmd === 'status') {
    const config = await getConfig(values.config)
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'extract', 'extract', process.cwd(), new Logger(config.messages))
        const {path: loaderPath, empty} = await handler.getLoaderPath()
        if (loaderPath && !empty) {
            await handler.init()
        } else {
            logger.info(`${key}:`)
            if (loaderPath) {
                logger.warn(`  Loader file empty at ${color.cyan(loaderPath)}`)
            } else {
                logger.warn('  No loader file found.')
            }
            logger.log(`  Run ${color.cyan('npx wuchale init')} to initialize.`)
        }
    }
} else {
    logger.warn(`Unknown command: ${cmd}`)
    logger.log(help)
}
