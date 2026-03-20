#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { type Config, defaultConfigNames, getConfig } from '../config.js'
import { color, type LogLevel, logLevels } from '../log.js'
import { check, checkHelp } from './check.js'
import { extract } from './extract.js'
import { status, statusHelp } from './status.js'

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
        json: {
            type: 'boolean',
            default: false,
        },
        full: {
            type: 'boolean',
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
        },
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
    ${color.cyan('check')}   Check for errors

Options:
    ${color.cyan('--config')}         use another config file instead of ${defaultConfigNames.map(color.cyan).join('|')}
    ${color.cyan('--clean')}, ${color.cyan('-c')}      remove unused messages from catalogs
    ${color.cyan('--watch')}, ${color.cyan('-w')}      continuously watch for file changes
    ${color.cyan('--sync')}           extract sequentially instead of in parallel
    ${color.cyan('--log-level')}, ${color.cyan('-l')}  {${Object.keys(logLevels).map(color.cyan)}} (only when no commands) set log level
    ${color.cyan('--help')}, ${color.cyan('-h')}       Show this help

You can specify ${color.cyan('--help')} after a sub-command for more.
`

async function configRootLocales(): Promise<[Config, string, string[]]> {
    const config = await getConfig(values.config)
    config.logLevel = values['log-level'] as LogLevel
    return [config, values.config ?? process.cwd(), config.locales]
}

if (cmd === 'status') {
    if (values.help) {
        console.log(statusHelp)
    } else {
        const [config, root] = await configRootLocales()
        await status(config, root, values.json)
    }
} else if (cmd === 'check') {
    if (values.help) {
        console.log(checkHelp)
    } else {
        const [config, root] = await configRootLocales()
        await check(config, root, values.full)
    }
} else if (values.help) {
    console.log('wuchale cli')
    console.log(help.trimEnd())
} else if (cmd == null) {
    const [config, root] = await configRootLocales()
    await extract(config, root, values.clean, values.watch, values.sync)
} else {
    console.warn(`${color.yellow('Unknown command')}: ${cmd}`)
    console.log(help)
}
