// $$ cd .. && npm run test
// $$ node %f

import { compileTranslation, isEquivalent } from '../compile.js'
import { getLanguageName } from '../config.js'
import { color, type Logger } from '../log.js'
import type { FileRef, Item } from '../storage.js'

const MAX_RETRIES = 30

type Batch = {
    id: number
    targetLocales: string[]
    messages: Item[]
}

type GroupKey = string | string[]

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

type InputItem = {
    id: string[]
    context?: string | undefined
    references: FileRef[]
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
    batches = new Map<GroupKey, Batch[]>()
    nextBatchId: number = 0
    running: Promise<void> | null = null
    sourceLocale: string
    ai: AI
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
        let translated: OutputItem[] = []
        try {
            const inputItems: InputItem[] = batch.messages.map(item => ({
                id: item.translations.get(this.sourceLocale)!,
                context: item.context,
                references: item.references,
            }))
            const translatedstr = await this.ai.translate(
                JSON.stringify(inputItems),
                instruct(this.sourceLocale, batch.targetLocales),
            )
            translated = JSON.parse(translatedstr)
            if (Array.isArray(translated)) {
                translated = translated.slice(0, batch.messages.length) // may return more
            } else {
                translated = []
            }
        } catch (err) {
            this.log.error(`${logStart}: ${color.red(`error: ${err}`)}`)
            return
        }
        const unTranslated: Item[] = batch.messages.slice(translated.length)
        for (const [i, outItem] of translated.entries()) {
            const item = batch.messages[i]
            const id = item.translations.get(this.sourceLocale)!
            const sourceComp = id.map(i => compileTranslation(i, ''))
            for (const loc of batch.targetLocales) {
                const translation = outItem[loc]
                if (translation === undefined) {
                    unTranslated.push(item)
                    break
                }
                if (id.length > 1) {
                    // plural
                    if (translation.length === 0) {
                        // TODO: pass pluralRule and check nplurals
                        unTranslated.push(item)
                        break
                    }
                    item.translations.set(loc, translation)
                    continue
                }
                if (translation.length !== id.length) {
                    unTranslated.push(item)
                    break
                }
                let equivalent = true
                for (const [i, sou] of sourceComp.entries()) {
                    if (!isEquivalent(sou, compileTranslation(translation[i], ''))) {
                        equivalent = false
                        break
                    }
                }
                if (!equivalent) {
                    unTranslated.push(item)
                    break
                }
                item.translations.set(loc, translation)
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
        while (this.batches.size > 0) {
            const allBatches: Batch[] = []
            for (const [group, batches] of this.batches) {
                while (batches.length > 0 && allBatches.length < this.ai.parallel) {
                    allBatches.push(batches.pop()!)
                }
                if (batches.length === 0) {
                    this.batches.delete(group)
                }
            }
            await Promise.all(allBatches.map(this.translate))
        }
        await this.onComplete()
        this.running = null
    }

    groupItemsByLocales = (items: Item[]) => {
        const itemsByLocales = new Map<GroupKey, Item[]>()
        for (const item of items) {
            for (const [loc, transl] of item.translations.entries()) {
                if (loc === this.sourceLocale || transl[0]) {
                    continue
                }
                const group = this.ai.group[this.sourceLocale]?.find(g => g.includes(loc))
                const groupKey = group ?? loc
                const groupItems = itemsByLocales.get(groupKey)
                if (groupItems == null) {
                    itemsByLocales.set(groupKey, [item])
                } else {
                    groupItems.push(item)
                }
            }
        }
        return itemsByLocales
    }

    prepItemsInBatches = (itemsByGroup: Map<GroupKey, Item[]>) => {
        const opInfo: [string, Batch, number][] = []
        for (let [groupKey, items] of itemsByGroup) {
            const groupBatches = this.batches.get(groupKey) ?? []
            const lastBatch = groupBatches.at(-1)
            if (lastBatch && lastBatch.messages.length < this.ai.batchSize) {
                const lastBatchFree = this.ai.batchSize - lastBatch.messages.length
                const itemsToAdd = items.slice(0, lastBatchFree)
                opInfo.push(['(add)', lastBatch, itemsToAdd.length])
                lastBatch.messages.push(...itemsToAdd)
                items = items.slice(lastBatchFree)
            }
            for (let i = 0; i < items.length; i += this.ai.batchSize) {
                const chunk = items.slice(i, i + this.ai.batchSize)
                const batch: Batch = {
                    id: this.nextBatchId,
                    targetLocales: Array.isArray(groupKey) ? groupKey : [groupKey],
                    messages: chunk,
                }
                groupBatches.push(batch)
                opInfo.push([color.yellow('(new)'), batch, chunk.length])
                this.nextBatchId++
            }
            if (!this.batches.has(groupKey)) {
                this.batches.set(groupKey, groupBatches)
            }
        }
        return opInfo
    }

    add = (items: Item[]) => {
        if (!this.ai) {
            return
        }
        const itemsByLocales = this.groupItemsByLocales(items)
        if (itemsByLocales.size === 0) {
            // all translated
            return
        }
        for (const [opType, batch, msgsLen] of this.prepItemsInBatches(itemsByLocales)) {
            this.log.info(
                `${this.#requestName(batch.id, batch.targetLocales)}: ${opType} translate ${color.cyan(msgsLen)} messages`,
            )
        }
        if (!this.running) {
            this.running = this.run()
        }
    }
}
