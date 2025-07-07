#!/usr/bin/env node

import createPlugin from "./plugin/index.js"

let clean = false
if (process.argv[2] === '--clean') {
    clean = true
}

const plugin = await createPlugin()
await plugin.configResolved({env: {EXTRACT: true}, root: process.cwd()})

console.log('Extracting...')

if (clean) {
    for (const loc of plugin._locales) {
        for (const item of Object.values(plugin._translations[loc])) {
            item.references = []
        }
    }
}

await plugin._directExtract()

if (clean) {
    for (const loc of plugin._locales) {
        for (const [key, item] of Object.entries(plugin._translations[loc])) {
            if (item.references.length === 0) {
                delete plugin._translations[loc][key]
            }
        }
        plugin._afterExtract(loc)
    }
}

console.log('Extraction finished.')
