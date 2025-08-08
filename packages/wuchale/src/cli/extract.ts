import type { Config } from "../config.js"
import { glob } from "tinyglobby"
import { AdapterHandler } from "../handler.js"
import { color, Logger } from "../log.js"
import { readFile } from "node:fs/promises"
import type { GlobConf } from "../adapters.js"
import { watch as watchFS } from 'chokidar'

function extractor(handler: AdapterHandler, logger: Logger) {
    const adapterName = color.magenta(handler.key)
    return async (filename: string) => {
        logger.log(`${adapterName}: Extract from ${color.cyan(filename)}`)
        const contents = await readFile(filename)
        await handler.transform(contents.toString(), filename)
    }
}

export async function extractAdap(handler: AdapterHandler, files: GlobConf, locales: string[], clean: boolean, logger: Logger) {
    await handler.init()
    if (clean) {
        for (const loc of locales) {
            for (const item of Object.values(handler.catalogs[loc])) {
                item.references = []
            }
        }
    }
    await Promise.all((await glob(...handler.globConfToArgs(files))).map(extractor(handler, logger)))
    if (clean) {
        logger.log('Cleaning...')
        for (const loc of locales) {
            for (const [key, item] of Object.entries(handler.catalogs[loc])) {
                if (item.references.length === 0) {
                    delete handler.catalogs[loc][key]
                }
            }
            await handler.savePoAndCompile(loc)
        }
    }
}

export async function extract(config: Config, locales: string[], logger: Logger, clean: boolean, watch: boolean) {
    !watch && logger.info('Extracting...')
    const handlers = []
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'extract', 'extract', process.cwd(), new Logger(config.messages))
        await extractAdap(handler, adapter.files, locales, clean, logger)
        handlers.push(handler)
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
