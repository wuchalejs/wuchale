import { readFile } from 'node:fs/promises'
import { watch as watchFS } from 'chokidar'
import type { Config } from '../config.js'
import { AdapterHandler, type SharedStates } from '../handler.js'
import { color, Logger } from '../log.js'

function extractor(handler: AdapterHandler, logger: Logger) {
    const adapterName = color.magenta(handler.key)
    return async (filename: string) => {
        logger.info(`${adapterName}: Extract from ${color.cyan(filename)}`)
        const contents = await readFile(filename)
        await handler.transform(contents.toString(), filename)
    }
}

export async function extract(config: Config, clean: boolean, watch: boolean, sync: boolean) {
    const logger = new Logger(config.logLevel)
    !watch && logger.info('Extracting...')
    const handlers: AdapterHandler[] = []
    const sharedState: SharedStates = new Map()
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'cli', process.cwd(), logger)
        await handler.init(sharedState)
        handlers.push(handler)
    }
    // other loop to make sure that all otherFileMatchers are collected
    for (const handler of handlers) {
        await handler.directScanFS(clean, sync)
    }
    if (!watch) {
        logger.info('Extraction finished.')
        return
    }
    // watch
    logger.info('Watching for changes')
    const handlersWithExtr = handlers.map(h => [h.fileMatches, extractor(h, logger)])
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
