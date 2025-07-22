#!/usr/bin/env node

import { getConfig } from "./config.js"
import { AdapterHandler } from "./handler.js"

let clean = false
if (process.argv[2] === '--clean') {
    clean = true
}

console.log('Extracting...')

const config = await getConfig()

const locales = Object.keys(config.locales)

for (const [i, adapter] of config.adapters.entries()) {
    const handler = new AdapterHandler(adapter, i, config, 'extract', process.cwd())
    await handler.init()

    if (clean) {
        for (const loc of locales) {
            for (const item of Object.values(handler.catalogs[loc])) {
                item.references = []
            }
        }
    }

    await handler.directExtract()

    if (clean) {
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

console.log('Extraction finished.')
