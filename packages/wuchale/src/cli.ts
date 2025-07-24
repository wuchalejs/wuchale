#!/usr/bin/env node

import { copyFile, mkdir } from "node:fs/promises"
import { getConfig } from "./config.js"
import { AdapterHandler } from "./handler.js"
import { parseArgs } from 'node:util'
import { dirname } from "node:path"
import { Logger } from "./adapters.js"

const { positionals, values } = parseArgs({
    options: {
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

const cmd = positionals[0] ?? 'help'

const help = `
Usage:

wuchale extract {--clean, -c}   Extract messages from the codebase into catalogs
                                deleting unused messages if --clean is specified
wuchale init                    Initialize on a codebase
wuchale {--help, -h}            Show this help
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
        console.info('Cleaning...')
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

if (cmd === 'help') {
    console.info('wuchale cli')
    console.info(help.trimEnd())
} else if (cmd === 'extract') {
    console.info('Extracting...')
    const config = await getConfig()
    const locales = Object.keys(config.locales)
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'extract', process.cwd(), new Logger(config.messages))
        await extract(handler, locales)
    }
    console.info('Extraction finished.')
} else if (cmd === 'init') {
    console.info('Initializing...')
    const config = await getConfig()
    let extractedNew = false
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'extract', process.cwd(), new Logger(config.messages))
        let loaderPath = await handler.getLoaderPath()
        if (loaderPath != null) {
            console.info('Loader already exists for', key, 'at', loaderPath)
            continue
        }
        loaderPath = handler.getLoaderPaths()[0]
        console.info('Create loader for', key, 'at', loaderPath)
        await mkdir(dirname(loaderPath), { recursive: true })
        await copyFile(await adapter.defaultLoaderPath(), loaderPath)
        console.info('Initial extract for', key)
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
            '  Set the GEMINI_API_KEY environment variable before starting the server',
            '  to enable live translation!',
            '\nYou can always run `npx wuchale extract`'
        )
    }
    console.info(msgs.join('\n'))
} else {
    console.warn(`Unknown command: ${cmd}`)
    console.info(help)
}
