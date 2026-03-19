import { relative } from 'node:path'
import { type Config, getLanguageName } from '../config.js'
import { Hub } from '../hub.js'
import { color } from '../log.js'

export async function status(config: Config, root: string, json: boolean) {
    // console.log because if the user invokes this command, they want full info regardless of config
    const hub = new Hub(() => config, root)
    await hub.init('cli', true)
    if (json) {
        console.log(JSON.stringify(await hub.status(), null, process.stdout.isTTY ? '  ' : undefined))
        return
    }
    for (const stat of await hub.status()) {
        console.log(`${color.magenta(stat.key)}:`)
        if (stat.loaders) {
            console.log(`  Loader files:`)
            for (const [side, path] of Object.entries(stat.loaders)) {
                console.log(`    ${color.cyan(side)}: ${color.cyan(relative(root, path))}`)
            }
        } else {
            console.warn(color.yellow('  No loader file found.'))
            console.log(`  Run ${color.cyan('npx wuchale')} to initialize.`)
        }
        if (!stat.storage.own) {
            console.log(`  Storage shared with ${color.magenta(stat.storage.ownerKey)}`)
            continue
        }
        console.log(`  Messages: ${color.cyan(stat.storage.total)} (${color.cyan(stat.storage.url)} URL)`)
        const statsData: Record<string, { Obsolete: number; Untranslated: number }> = {}
        for (const det of stat.storage.details) {
            statsData[getLanguageName(det.locale)] = {
                Obsolete: det.obsolete,
                Untranslated: det.untranslated,
            }
        }
        console.table(statsData)
    }
}
