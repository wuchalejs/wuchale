import { relative } from 'node:path'
import { type Config, getLanguageName } from '../config.js'
import { AdapterHandler } from '../handler/index.js'
import { SharedStates } from '../handler/state.js'
import { color, Logger } from '../log.js'
import { type Catalog, itemIsObsolete, itemIsUrl } from '../storage.js'

type POStats = {
    Total: number
    Untranslated: number
    Obsolete: number
}

async function statCatalog(locale: string, catalog: Catalog, urls: boolean): Promise<POStats> {
    const stats: POStats = { Total: 0, Untranslated: 0, Obsolete: 0 }
    for (const item of catalog.values()) {
        if (itemIsUrl(item) !== urls) {
            continue
        }
        stats.Total++
        if (!item.translations.get(locale)!.msgstr[0]) {
            stats.Untranslated++
        }
        if (itemIsObsolete(item)) {
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
        const state = handler.sharedState
        const loaderPath = await handler.files.getLoaderPath()
        console.log(`${color.magenta(key)}: ${color.cyan(state.catalog.size)} messages`)
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
                await state.load()
                const stats = await statCatalog(locale, state.catalog, url)
                if (stats.Total === 0) {
                    continue
                }
                statsData[name] = stats
            }
        }
        console.table(statsData)
    }
}
