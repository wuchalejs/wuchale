#!/usr/bin/env node

import { defaultConfigNames, getConfig, type Config } from "../config.js"
import { parseArgs } from 'node:util'
import { color, logLevels, type LogLevel } from "../log.js"
import { extract } from "./extract.js"
import { status } from "./status.js"

const { positionals, values } = parseArgs({
    options: {
        config: {
            type: 'string',
        },
        clean: {
            type: 'boolean',
            short: 'c',
            default: false,
        },
        watch: {
            type: 'boolean',
            short: 'w',
            default: false,
        },
        sync: {
            type: 'boolean',
            default: false,
        },
        'log-level': {
            type: 'string',
            short: 'l',
            default: 'info',
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
    ${color.cyan('status')}  Show current status

Options:
    ${color.cyan('--config')}         use another config file instead of ${defaultConfigNames.map(color.cyan).join('|')}
    ${color.cyan('--clean')}, ${color.cyan('-c')}      (only when no commands) remove unused messages from catalogs
    ${color.cyan('--watch')}, ${color.cyan('-w')}      (only when no commands) continuously watch for file changes
    ${color.cyan('--sync')}           (only when no commands) extract sequentially instead of in parallel
    ${color.cyan('--log-level')}, ${color.cyan('-l')}  {${Object.keys(logLevels).map(color.cyan)}} (only when no commands) set log level
    ${color.cyan('--help')}, ${color.cyan('-h')}       Show this help
`

async function getConfigNLocales(): Promise<[Config, string[]]> {
    const config = await getConfig(values.config)
    config.logLevel = values["log-level"] as LogLevel
    return [ config, config.locales ]
}

if (values.help) {
    console.log('wuchale cli')
    console.log(help.trimEnd())
} else if (cmd == null) {
    await extract((await getConfigNLocales())[0], values.clean, values.watch, values.sync)
} else if (cmd === 'status') {
    await status(...await getConfigNLocales())
} else {
    console.warn(`${color.yellow('Unknown command')}: ${cmd}`)
    console.log(help)
}
