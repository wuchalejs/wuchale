import { readFile } from 'node:fs/promises'
import { watch as watchFS } from 'chokidar'
import { glob } from 'tinyglobby'
import type { Config } from '../config.js'
import { globConfToArgs } from '../handler/files.js'
import { AdapterHandler } from '../handler/index.js'
import { SharedStates } from '../handler/state.js'
import { color, Logger } from '../log.js'
import { itemIsObsolete } from '../storage.js'

type VisitFileFunc = (filename: string) => Promise<boolean>

async function directScanFS(
    handler: AdapterHandler,
    extract: VisitFileFunc,
    filePaths: string[],
    clean: boolean,
    sync: boolean,
    logger: Logger,
) {
    const catalog = handler.sharedState.catalog
    let updated = false
    if (sync) {
        for (const fPath of filePaths) {
            updated ||= await extract(fPath)
        }
    } else {
        updated ||= (await Promise.all(filePaths.map(extract))).some(r => r)
    }
    // only owner adapter should clean
    if (clean && handler.sharedState.ownerKey === handler.key) {
        const adapterNameLog = color.magenta(handler.key)
        logger.info(`${adapterNameLog}: Cleaning...`)
        let cleaned = 0
        for (const [key, item] of catalog) {
            const initRefsN = item.references.length
            item.references = item.references.filter(
                ref =>
                    handler.fileMatches(ref.file) ||
                    handler.sharedState.otherFileMatches.some(match => match(ref.file)),
            )
            if (item.references.length < initRefsN) {
                updated = true
                cleaned++
            }
            if (itemIsObsolete(item)) {
                catalog.delete(key)
                updated = true
                cleaned++
            }
        }
        if (cleaned) {
            logger.info(`${adapterNameLog}: Cleaned ${cleaned} items`)
        }
    }
    if (updated) {
        await handler.sharedState.save()
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
            const [, updated] = await handler.transform(contents.toString(), filename)
            return updated
        }
        const filePaths = await glob(...globConfToArgs(adapter.files, config.localesDir, adapter.outDir))
        handlers.push([handler, extract, filePaths])
    }
    // owner adapter handlers should run last for cleanup
    handlers.sort(([handler]) => (handler.sharedState.ownerKey === handler.key ? 1 : -1))
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
