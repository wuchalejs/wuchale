#!/usr/bin/env node

import { getConfig } from "./config.js"
import { AdapterHandler } from "./plugin/handler.js"
import { IndexTracker } from "./plugin/transform.js"

let clean = false
if (process.argv[2] === '--clean') {
    clean = true
}

console.log('Extracting...')

const config = await getConfig()

const locales = Object.keys(config.locales)

for (const adapter of config.adapters) {
    const handler = new AdapterHandler(adapter, config, new IndexTracker(), 'extract', process.cwd())
    await handler.init()

    if (clean) {
        for (const loc of locales) {
            for (const item of Object.values(handler.translations[loc])) {
                item.references = []
            }
        }
    }

    await handler.directExtract()

    if (clean) {
        for (const loc of locales) {
            for (const [key, item] of Object.entries(handler.translations[loc])) {
                if (item.references.length === 0) {
                    delete handler.translations[loc][key]
                }
            }
            await handler.afterExtract(loc)
        }
    }
}

console.log('Extraction finished.')
