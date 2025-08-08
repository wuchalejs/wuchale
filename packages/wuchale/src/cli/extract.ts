import type { Config } from "../config.js"
import { glob } from "tinyglobby"
import { AdapterHandler } from "../handler.js"
import { color, Logger } from "../log.js"
import { readFile } from "node:fs/promises"
import type { GlobConf } from "../adapters.js"

export async function extractAdap(handler: AdapterHandler, files: GlobConf, locales: string[], clean: boolean, logger: Logger) {
    await handler.init()
    if (clean) {
        for (const loc of locales) {
            for (const item of Object.values(handler.catalogs[loc])) {
                item.references = []
            }
        }
    }
    const all = []
    for (const file of await glob(...handler.globConfToArgs(files))) {
        logger.log(`Extract from ${color.cyan(file)}`)
        const contents = await readFile(file)
        all.push(handler.transform(contents.toString(), file))
    }
    await Promise.all(all)
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

export async function extract(config: Config, locales: string[], logger: Logger, clean: boolean) {
    logger.info('Extracting...')
    for (const [key, adapter] of Object.entries(config.adapters)) {
        const handler = new AdapterHandler(adapter, key, config, 'extract', 'extract', process.cwd(), new Logger(config.messages))
        await extractAdap(handler, adapter.files, locales, clean, logger)
    }
    logger.info('Extraction finished.')
}
