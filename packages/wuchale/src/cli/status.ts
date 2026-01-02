import { type Config, getLanguageName } from '../config.js'
import { AdapterHandler, loadPOFile } from '../handler.js'
import { color, Logger } from '../log.js'

type POStats = {
    total: number
    untranslated: number
    obsolete: number
}

async function statPO(filename: string): Promise<POStats> {
    const po = await loadPOFile(filename)
    const stats: POStats = { total: 0, untranslated: 0, obsolete: 0 }
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
    console.log(`Locales: ${locales.map((l) => color.cyan(`${l} (${getLanguageName(l)})`)).join(', ')}`)
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'cli', process.cwd(), new Logger(config.logLevel))
        const loaderPath = await handler.getLoaderPath()
        console.log(`${color.magenta(key)}:`)
        if (loaderPath) {
            console.log(`  Loader files:`)
            for (const [side, path] of Object.entries(loaderPath)) {
                console.log(`    ${color.cyan(side)}: ${color.cyan(path)}`)
            }
        } else {
            console.warn(color.yellow('  No loader file found.'))
            console.log(`  Run ${color.cyan('npx wuchale init')} to initialize.`)
        }
        const statsData: Record<string, { Total: number; Untranslated: number; Obsolete: number }> = {}
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
            const { total, obsolete, untranslated } = stats
            const locName = getLanguageName(locale)
            statsData[locName] = {
                Total: total,
                Untranslated: untranslated,
                Obsolete: obsolete,
            }
        }
        console.table(statsData)
    }
}
