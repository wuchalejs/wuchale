import { readFile } from 'node:fs/promises'
import { watch as watchFS } from 'chokidar'
import { glob } from 'tinyglobby'
import type { Config } from '../config.js'
import { globConfToArgs } from '../handler/files.js'
import { AdapterHandler } from '../handler/index.js'
import { SharedStates } from '../handler/state.js'
import { color, Logger } from '../log.js'
import { type Catalog, itemIsObsolete } from '../storage.js'

type VisitFileFunc = (filename: string) => Promise<void>

const dump = (catalog: Catalog) =>
    JSON.stringify(Array.from(catalog.values()), (_, v) => (v instanceof Map ? Object.fromEntries(v) : v))

async function directScanFS(
    handler: AdapterHandler,
    extract: VisitFileFunc,
    filePaths: string[],
    clean: boolean,
    sync: boolean,
    logger: Logger,
) {
    const state = handler.sharedState
    const catalog = state.catalog
    const initDump = dump(catalog)
    if (clean) {
        for (const item of catalog.values()) {
            item.references = item.references.filter(ref => {
                if (handler.fileMatches(ref.file)) {
                    return false
                }
                if (handler.sharedState.ownerKey !== handler.key) {
                    return true
                }
                return handler.sharedState.otherFileMatches.some(match => match(ref.file))
            })
        }
    }
    if (sync) {
        for (const fPath of filePaths) {
            await extract(fPath)
        }
    } else {
        await Promise.all(filePaths.map(extract))
    }
    if (clean) {
        logger.info('Cleaning...')
        for (const [key, item] of catalog.entries()) {
            if (itemIsObsolete(item)) {
                catalog.delete(key)
            }
        }
    }
    if (dump(catalog) !== initDump) {
        await state.save()
    }
}

export async function extract(config: Config, root: string, clean: boolean, watch: boolean, sync: boolean) {
    const logger = new Logger(config.logLevel)
    !watch && logger.info('Extracting...')
    const handlers: [AdapterHandler, VisitFileFunc, string[]][] = []
    const sharedState = new SharedStates()
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'cli', root, logger)
        await handler.init(sharedState)
        const adapterName = color.magenta(handler.key)
        const extract = async (filename: string) => {
            logger.info(`${adapterName}: Extract from ${color.cyan(filename)}`)
            const contents = await readFile(filename)
            await handler.transform(contents.toString(), filename)
        }
        const filePaths = await glob(...globConfToArgs(adapter.files, config.localesDir, adapter.outDir))
        handlers.push([handler, extract, filePaths])
    }
    // separate loop to make sure that all otherFileMatchers are collected
    for (const [handler, extract, files] of handlers) {
        await directScanFS(handler, extract, files, clean, sync, logger)
    }
    if (!watch) {
        logger.info('Extraction finished.')
        return
    }
    // watch
    logger.info('Watching for changes')
    watchFS('.', { ignoreInitial: true }).on('all', async (event, filename) => {
        if (!['add', 'change'].includes(event)) {
            return
        }
        for (const [handler, extract] of handlers) {
            if (handler.fileMatches(filename)) {
                await extract(filename)
            }
        }
    })
}
