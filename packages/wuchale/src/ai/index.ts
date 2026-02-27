// $$ cd .. && npm run test
// $$ node %f

import { compileTranslation, isEquivalent } from '../compile.js'
import { getLanguageName } from '../config.js'
import { color, type Logger } from '../log.js'
import type { Item } from '../storage.js'

const MAX_RETRIES = 30

type Batch = {
    id: number
    targetLocales: string[]
    messages: Item[]
}

export type AIPassThruOpts = {
    batchSize: number
    parallel: number
    group: Record<string, string[][]>
}

export type AI = AIPassThruOpts & {
    name: string
    translate: (messages: string, instruction: string) => Promise<string>
}

// by locale
type OutputItem = Record<string, string[]>

const outputSchema = {
    type: 'array',
    items: {
        type: 'object',
        description: 'Keyed by locale code',
        additionalProperties: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
        },
    },
}

const instruct = (sourceLocale: string, targetLocales: string[]) =>
    `
You are a professional translator for a web application.
You will be given a list of items to translate from ${sourceLocale} (${getLanguageName(sourceLocale)}) to ${targetLocales.map(l => `${l} (${getLanguageName(l)})`).join(', ')}.

Each item has:
- id: the source text (array for singular/plural forms)
- context: optional disambiguation context
- references[]: source file locations
    - file: the file path where it was used
    - refs:
        - link: the href that matches the original in the case of urls
        - placeholders: descriptions of numbered placeholders used in the text

For regional variants of the same language (e.g. fr and fr-CH), keep translations identical unless a regional convention genuinely requires a difference.

Preserve all placeholders exactly as they appear in the source. The placeholder formats are:
- {0}: an interpolated value (any integer, not just 0)
- <0>text</0>: text wrapped in a tag (like an HTML element)
- <0/>: a self-closing tag

For items with multiple id entries, these are plural forms. Provide the corresponding number of plural forms for each target locale.

Respond with a JSON array matching the order of the input items. Each element is an object keyed by locale code, where each value is an array of translated strings (one per plural form, or a single-element array for non-plural items).

Output schema:
${JSON.stringify(outputSchema)}

Respond ONLY with raw compact JSON. Do not wrap it in markdown code fences or add any other text.
`.trim()

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

    #requestName = (id: number, targetLocales: string[]) =>
        `${color.cyan(this.ai.name)}: ${this.sourceLocale}..[${targetLocales.join(',')}] [${id}]`

    translate = async (batch: Batch, attempt = 0) => {
        const logStart = this.#requestName(batch.id, batch.targetLocales)
        let translated: OutputItem[]
        try {
            const translatedstr = await this.ai.translate(
                JSON.stringify(
                    batch.messages.map(item => ({
                        id: item.id,
                        context: item.context,
                        references: item.references,
                    })),
                ),
                instruct(this.sourceLocale, batch.targetLocales),
            )
            translated = JSON.parse(translatedstr)
        } catch (err) {
            this.log.error(`${logStart}: ${color.red(`error: ${err}`)}`)
            return
        }
        const unTranslated: Item[] = batch.messages.slice(translated.length)
        for (const [i, outItem] of translated.entries()) {
            const item = batch.messages[i]
            const sourceComp = item.id.map(i => compileTranslation(i, ''))
            for (const loc of batch.targetLocales) {
                const translation = outItem[loc]
                if (translation.length !== item.id.length) {
                    unTranslated.push(item)
                    break
                }
                for (const [i, sou] of sourceComp.entries()) {
                    if (!isEquivalent(sou, compileTranslation(translation[i], ''))) {
                        unTranslated.push(item)
                        break
                    }
                }
                item.translations.get(loc)!.text = translation
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
        const itemsByLocales = new Map<string | string[], Item[]>()
        for (const item of messages) {
            for (const [loc, transl] of item.translations.entries()) {
                if (loc === this.sourceLocale || transl.text[0]) {
                    continue
                }
                const group = this.ai.group[this.sourceLocale]?.find(g => g.includes(loc))
                const groupKey = group ?? loc
                if (!itemsByLocales.has(groupKey)) {
                    itemsByLocales.set(groupKey, [])
                }
                itemsByLocales.get(groupKey)?.push(item)
            }
        }
        if (itemsByLocales.size === 0) {
            // all translated
            return
        }
        const opInfo: [string, Batch, number][] = []
        const lastBatch = this.batches.at(-1)
        if (lastBatch && lastBatch.messages.length < this.ai.batchSize && itemsByLocales.has(lastBatch.targetLocales)) {
            const lastBatchFree = this.ai.batchSize - lastBatch.messages.length
            const localeItems = itemsByLocales.get(lastBatch.targetLocales)!
            const msgs = localeItems.slice(0, lastBatchFree)
            opInfo.push(['(add)', lastBatch, msgs.length])
            lastBatch.messages.push(...msgs)
            itemsByLocales.set(lastBatch.targetLocales, localeItems.slice(lastBatchFree))
        }
        for (const [groupKey, items] of itemsByLocales) {
            if (items.length === 0) {
                continue
            }
            const batch = {
                id: this.nextBatchId,
                targetLocales: Array.isArray(groupKey) ? groupKey : [groupKey],
                messages: items,
            }
            this.batches.push(batch)
            opInfo.push([color.yellow('(new)'), batch, items.length])
            this.nextBatchId++
        }
        for (const [opType, batch, msgsLen] of opInfo) {
            this.log.info(
                `${this.#requestName(batch.id, batch.targetLocales)}: ${opType} translate ${color.cyan(msgsLen)} messages`,
            )
        }
        if (!this.running) {
            this.running = this.run()
        }
    }
}
