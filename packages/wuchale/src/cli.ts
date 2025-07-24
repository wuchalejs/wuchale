#!/usr/bin/env node

import { copyFile, mkdir } from "node:fs/promises"
import { getConfig } from "./config.js"
import { AdapterHandler } from "./handler.js"
import { parseArgs } from 'node:util'
import { dirname } from "node:path"

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
        console.log('Cleaning...')
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
    console.log('wuchale cli')
    console.log(help.trimEnd())
} else if (cmd === 'extract') {
    console.log('Extracting...')
    const config = await getConfig()
    const locales = Object.keys(config.locales)
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'extract', process.cwd())
        await extract(handler, locales)
    }
    console.log('Extraction finished.')
} else if (cmd === 'init') {
    console.log('Initializing...')
    const config = await getConfig()
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'extract', process.cwd())
        let loaderPath = await handler.getLoaderPath()
        if (loaderPath != null) {
            console.log('Loader already exists for', key, 'at', loaderPath)
            continue
        }
        loaderPath = handler.getLoaderPaths()[0]
        console.log('Create loader for', key, 'at', loaderPath)
        await mkdir(dirname(loaderPath), { recursive: true })
        await copyFile(await adapter.defaultLoaderPath(), loaderPath)
        console.log('Initial extract for', key)
        await extract(handler, Object.keys(config.locales))
    }
} else {
    console.log(`Unknown command: ${cmd}`)
    console.log(help)
}
