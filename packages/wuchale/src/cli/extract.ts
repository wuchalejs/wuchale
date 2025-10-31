import type { Config } from "../config.js"
import { glob } from "tinyglobby"
import { AdapterHandler, urlPatternFlag, type SharedStates } from "../handler.js"
import { color, Logger } from "../log.js"
import { readFile } from "node:fs/promises"
import type { GlobConf } from "../adapters.js"
import { watch as watchFS } from 'chokidar'
import PO from "pofile"
import type { ItemType } from "../ai/index.js"

function extractor(handler: AdapterHandler) {
    const adapterName = color.magenta(handler.key)
    return async (filename: string) => {
        console.info(`${adapterName}: Extract from ${color.cyan(filename)}`)
        const contents = await readFile(filename)
        await handler.transform(contents.toString(), filename)
    }
}

function poDump(items: ItemType[]) {
    const po = new PO()
    po.items = items
    return po.toString()
}

export async function extractAdap(handler: AdapterHandler, sharedState: SharedStates, files: GlobConf, locales: string[], clean: boolean, sync: boolean) {
    await handler.init(sharedState)
    const dumps: Record<string, string> = {}
    for (const loc of locales) {
        const items = Object.values(handler.sharedState.poFilesByLoc[loc].catalog)
        dumps[loc] = poDump(items)
        if (clean) {
            for (const item of items) {
                // unreference all references that belong to this adapter
                if (item.flags[urlPatternFlag]) {
                    item.references = item.references.filter(ref => ref !== handler.key)
                } else {
                    // don't touch other adapters' files
                    item.references = item.references.filter(ref => !handler.fileMatches(ref))
                }
            }
        }
        await handler.initUrlPatterns(loc)
    }
    const filePaths = await glob(...handler.globConfToArgs(files))
    const extract = extractor(handler)
    if (sync) {
        for (const fPath of filePaths) {
            await extract(fPath)
        }
    } else {
        await Promise.all(filePaths.map(extract))
    }
    if (clean) {
        console.info('Cleaning...')
    }
    for (const loc of locales) {
        if (clean) {
            const catalog = handler.sharedState.poFilesByLoc[loc].catalog
            for (const [key, item] of Object.entries(catalog)) {
                if (item.references.length === 0) {
                    delete catalog[key]
                }
            }
        }
        const newDump = poDump(Object.values(handler.sharedState.poFilesByLoc[loc].catalog))
        if (newDump !== dumps[loc]) {
            await handler.savePO(loc)
        }
    }
}

export async function extract(config: Config, locales: string[], clean: boolean, watch: boolean, sync: boolean) {
    !watch && console.info('Extracting...')
    const handlers = []
    const sharedState: SharedStates = {}
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'cli', process.cwd(), new Logger(config.logLevel))
        await extractAdap(handler, sharedState, adapter.files, locales, clean, sync)
        handlers.push(handler)
    }
    if (!watch) {
        console.info('Extraction finished.')
        return
    }
    // watch
    console.info('Watching for changes')
    const handlersWithExtr = handlers.map(h => [h.fileMatches, extractor(h)])
    watchFS('.', { ignoreInitial: true }).on('all', async (event, filename) => {
        if (!['add', 'change'].includes(event)) {
            return
        }
        for (const [fileMatches, extract] of handlersWithExtr) {
            if (fileMatches(filename)) {
                await extract(filename)
            }
        }
    })
}
