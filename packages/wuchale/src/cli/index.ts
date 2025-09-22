#!/usr/bin/env node

import { defaultConfigNames, getConfig, type Config } from "../config.js"
import { parseArgs } from 'node:util'
import { color, Logger } from "../log.js"
import { extract } from "./extract.js"
import { init } from "./init.js"
import { status } from "./status.js"

const { positionals, values } = parseArgs({
    options: {
        config: {
            type: 'string',
        },
        clean: {
            type: 'boolean',
            short: 'c',
        },
        watch: {
            type: 'boolean',
            short: 'w',
        },
        sync: {
            type: 'boolean',
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
    ${color.cyan('--config')}     use another config file instead of ${defaultConfigNames.map(color.cyan).join('|')}
    ${color.cyan('--clean')}, ${color.cyan('-c')}  (only when no commands) remove unused messages from catalogs
    ${color.cyan('--watch')}, ${color.cyan('-w')}  (only when no commands) continuously watch for file changes
    ${color.cyan('--sync')}       (only when no commands) extract sequentially instead of in parallel
    ${color.cyan('--help')}, ${color.cyan('-h')}   Show this help
`

const logger = new Logger(true)

async function getConfigNLocales(): Promise<[Config, string[]]> {
    const config = await getConfig(values.config)
    const locales = [config.sourceLocale, ...config.otherLocales]
    return [ config, locales ]
}

if (values.help) {
    logger.log('wuchale cli')
    logger.log(help.trimEnd())
} else if (cmd == null) {
    await extract(...await getConfigNLocales(), logger, values.clean, values.watch, values.sync)
} else if (cmd === 'init') {
    await init(...await getConfigNLocales(), logger)
} else if (cmd === 'status') {
    await status(...await getConfigNLocales(), logger)
} else {
    logger.warn(`Unknown command: ${cmd}`)
    logger.log(help)
}
