// $$ cd .. && npm run test
// $$ node %f

import PO from 'pofile'
import { getLanguageName } from '../config.js'
import { color, type Logger } from '../log.js'
import { itemToPOItem, poitemToItem } from '../pofile.js'
import type { Item } from '../storage.js'

const MAX_RETRIES = 30

type Batch = {
    id: number
    targetLocale: string
    messages: Item[]
}

export type AI = {
    name: string
    batchSize: number
    translate: (messages: string, instruction: string) => Promise<string>
    parallel: number
}

const instruct = (sourceLocale: string, targetLocale: string) => `
    You will be given the contents of a gettext .po file for a web app.
    Translate each of the items from ${getLanguageName(sourceLocale)} to ${getLanguageName(targetLocale)}.
    You can read all of the information for the items including contexts,
    comments and references to get the appropriate context about each item.
    Provide the same content with the only difference being that the
    empty msgstr quotes should be filled with the appropriate translations,
    preserving all placeholders.
    The placeholder format is like the following examples:
        - {0}: means arbitrary values.
        - <0>something</0>: means something enclosed in some tags, like HTML tags
        - <0/>: means a self closing tag, like in HTML
    In all of the examples, 0 is an example for any integer.
`

// implements a queue for a sequential translation useful for vite's transform during dev
// as vite can do async transform
export default class AIQueue {
    batches: Batch[] = []
    nextBatchId: number = 0
    running: Promise<void> | null = null
    sourceLocale: string
    ai: AI
    instruction: string
    onComplete: () => Promise<void>
    log: Logger

    constructor(sourceLocale: string, ai: AI, onComplete: () => Promise<void>, log: Logger) {
        this.sourceLocale = sourceLocale
        this.ai = ai
        this.onComplete = onComplete
        this.log = log
    }

    #requestName = (id: number, targetLocale: string) =>
        `${color.cyan(this.ai.name)}: ${getLanguageName(targetLocale)} [${id}]`

    translate = async (batch: Batch, attempt = 0) => {
        const logStart = this.#requestName(batch.id, batch.targetLocale)
        let translated: Item[]
        try {
            const po = new PO()
            po.items = batch.messages.map(item => itemToPOItem(item, batch.targetLocale))
            const translatedstr = await this.ai.translate(
                po.toString(),
                instruct(this.sourceLocale, batch.targetLocale),
            )
            translated = PO.parse(translatedstr).items.map(poi => poitemToItem(poi, batch.targetLocale))
        } catch (err) {
            this.log.error(`${logStart}: ${color.red(`error: ${err}`)}`)
            return
        }
        const unTranslated: Item[] = batch.messages.slice(translated.length)
        for (const [i, item] of translated.entries()) {
            const destItem = batch.messages[i]
            if (item.msgid.join('\n') !== destItem?.msgid?.join('\n')) {
                unTranslated.push(destItem)
                continue
            }
            const msgstr = item.translations.get(batch.targetLocale)?.msgstr
            if (msgstr?.[0]) {
                destItem.translations.get(batch.targetLocale)!.msgstr = msgstr
            } else {
                unTranslated.push(destItem)
            }
        }
        if (unTranslated.length === 0) {
            this.log.info(`${logStart}: ${color.green('translated')}`)
            return
        }
        attempt++
        if (attempt === MAX_RETRIES) {
            this.log.error(`${logStart}: Giving up after ${attempt} unsuccessful retries`)
            return
        }
        this.log.warn(`${logStart}: ${unTranslated.length} ${color.yellow('messages not translated. Retrying...')}`)
        batch.messages = unTranslated
        await this.translate(batch, attempt)
    }

    run = async () => {
        while (this.batches.length > 0) {
            const allBatches: Batch[] = []
            while (this.batches.length > 0 && allBatches.length < this.ai.parallel) {
                allBatches.push(this.batches.pop() as Batch)
            }
            await Promise.all(allBatches.map(this.translate))
        }
        await this.onComplete()
        this.running = null
    }

    add = (messages: Item[]) => {
        if (!this.ai) {
            return
        }
        const itemsByLocales = new Map<string, Item[]>()
        for (const item of messages) {
            for (const [loc, transl] of item.translations.entries()) {
                if (loc === this.sourceLocale || transl.msgstr[0]) {
                    continue
                }
                if (itemsByLocales.has(loc)) {
                    itemsByLocales.set(loc, [])
                }
                itemsByLocales.get(loc)?.push(item)
            }
        }
        if (itemsByLocales.size === 0) {
            // all translated
            return
        }
        const opInfo: [string, Batch, number][] = []
        const lastBatch = this.batches.at(-1)
        if (lastBatch && lastBatch.messages.length < this.ai.batchSize && itemsByLocales.has(lastBatch.targetLocale)) {
            const lastBatchFree = this.ai.batchSize - lastBatch.messages.length
            const localeItems = itemsByLocales.get(lastBatch.targetLocale)!
            const msgs = localeItems.slice(0, lastBatchFree)
            opInfo.push(['(add)', lastBatch, msgs.length])
            lastBatch.messages.push(...msgs)
            itemsByLocales.set(lastBatch.targetLocale, localeItems.slice(lastBatchFree))
        }
        for (const [loc, items] of itemsByLocales) {
            if (items.length === 0) {
                continue
            }
            const batch = { id: this.nextBatchId, targetLocale: loc, messages }
            this.batches.push(batch)
            opInfo.push([color.yellow('(new)'), batch, messages.length])
            this.nextBatchId++
        }
        for (const [opType, batch, msgsLen] of opInfo) {
            this.log.info(
                `${this.#requestName(batch.id, batch.targetLocale)}: ${opType} translate ${color.cyan(msgsLen)} messages`,
            )
        }
        if (!this.running) {
            this.running = this.run()
        }
    }
}
