import { relative } from 'node:path'
import { type Config, getLanguageName } from '../config.js'
import { AdapterHandler } from '../handler/index.js'
import { POFile } from '../handler/pofile.js'
import { SharedStates } from '../handler/state.js'
import { color, Logger } from '../log.js'

type POStats = {
    Total: number
    Untranslated: number
    Obsolete: number
}

async function statPO(poFile: POFile, urlPart: boolean): Promise<POStats> {
    const po = await poFile.loadRaw(urlPart, false)
    const stats: POStats = { Total: 0, Untranslated: 0, Obsolete: 0 }
    for (const item of po?.items ?? []) {
        stats.Total++
        if (!item.msgstr[0]) {
            stats.Untranslated++
        }
        if (item.obsolete) {
            stats.Obsolete++
        }
    }
    return stats
}

export async function status(config: Config, root: string, locales: string[]) {
    // console.log because if the user invokes this command, they want full info regardless of config
    console.log(`Locales: ${locales.map(l => color.cyan(`${l} (${getLanguageName(l)})`)).join(', ')}`)
    const sharedStates = new SharedStates()
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'cli', root, new Logger(config.logLevel))
        handler.initSharedState(sharedStates)
        const loaderPath = await handler.files.getLoaderPath()
        console.log(`${color.magenta(key)}:`)
        if (loaderPath) {
            console.log(`  Loader files:`)
            for (const [side, path] of Object.entries(loaderPath)) {
                console.log(`    ${color.cyan(side)}: ${color.cyan(relative(root, path))}`)
            }
        } else {
            console.warn(color.yellow('  No loader file found.'))
            console.log(`  Run ${color.cyan('npx wuchale init')} to initialize.`)
        }
        const statsData: Record<string, POStats> = {}
        for (const locale of locales) {
            const locName = getLanguageName(locale)
            for (const [name, url] of [
                [locName, false],
                [`${locName} URL`, true],
            ] as [string, boolean][]) {
                const stats = await statPO(handler.sharedState.poFilesByLoc.get(locale)!, url)
                if (stats.Total === 0) {
                    continue
                }
                statsData[name] = stats
            }
        }
        console.table(statsData)
    }
}
