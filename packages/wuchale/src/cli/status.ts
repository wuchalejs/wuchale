import { AdapterHandler, loadPOFile } from "../handler.js"
import { type Config, getLanguageName } from "../config.js"
import { color, Logger } from "../log.js"

type POStats = {
    total: number
    untranslated: number
    obsolete: number
}

async function statPO(filename: string): Promise<POStats> {
    const po = await loadPOFile(filename)
    const stats: POStats = {total: 0, untranslated: 0, obsolete: 0}
    for (const item of po.items) {
        stats.total++
        if (!item.msgstr[0]) {
            stats.untranslated++
        }
        if (item.obsolete) {
            stats.obsolete++
        }
    }
    return stats
}

export async function status(config: Config, locales: string[]) {
    // console.log because if the user invokes this command, they want full info regardless of config
    console.log(`Locales: ${locales.map(l => color.cyan(`${l} (${getLanguageName(l)})`)).join(', ')}`)
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'extract', 'extract', process.cwd(), new Logger(config.logLevel))
        const {path: loaderPath, empty} = await handler.getLoaderPath()
        console.log(`${color.magenta(key)}:`)
        for (const locale of locales) {
            let stats: POStats
            try {
                stats = await statPO(handler.catalogFileName(locale))
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw err
                }
                console.warn(color.yellow('  No catalog found.'))
                continue
            }
            const {total, obsolete, untranslated} = stats
            const locName = getLanguageName(locale)
            console.log([
                `  ${locName}: ${color.cyan(`total: ${total}`)}`,
                color.yellow(`untranslated: ${untranslated}`),
                color.grey(`obsolete: ${obsolete}`),
            ].join(', '))
        }
        if (loaderPath) {
            console.log(`  Loader files:`)
            for (const [side, path] of Object.entries(loaderPath)) {
                console.log(`    ${color.cyan(side)}: ${color.cyan(path)}${empty[side] ? color.yellow(' (empty)') : ''}`)
            }
            continue
        } else {
            console.warn(color.yellow('  No loader file found.'))
        }
        console.log(`  Run ${color.cyan('npx wuchale init')} to initialize.`)
    }
}
