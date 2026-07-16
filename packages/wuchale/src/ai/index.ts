// $$ cd .. && npm run test
// $$ node %f

import { compileTranslation } from '../compile.js'
import { getLanguageName } from '../config.js'
import { color, type Logger } from '../log.js'
import type { FileRef, Item } from '../storage.js'
import { isEquivalent, pluralForms } from '../validate.js'

const MAX_RETRIES = 30

type Batch = {
    id: number
    targetLocales: string[]
    plurals: Intl.LDMLPluralRule[]
    items: Item[]
}

type GroupKey = string | string[]

export type AIPassThruOpts = {
    batchSize: number
    parallel: number
    group: Record<string, string[][]>
}

export type AI = AIPassThruOpts & {
    name: string
    translate: (body: string, instruction: string) => Promise<string>
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
    id: string | string[]
    context?: string | undefined
    references: FileRef[]
}

const instruct = (sourceLocale: string, targetLocales: string[], plurals: Intl.LDMLPluralRule[] | null) =>
    `
You are a professional translator for a web application.
You will be given a list of items to translate from ${sourceLocale} (${getLanguageName(sourceLocale)}) to ${targetLocales.map(l => `${l} (${getLanguageName(l)})`).join(', ')}.

Each item has:
- id: the source text (array for plural forms)
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

${plurals === null ? '' : `For items with multiple id entries, these are plural forms. Provide the corresponding number of plural forms for each target locale.${plurals.length > 0 ? ` The plural forms should be ordered like: ${plurals.join(', ')}.` : ''}`}

Respond with a JSON array matching the order of the input items. Each element is an object keyed by locale code, where each value is an array of translated strings (one per plural form, or a single-element array for non-plural items).

Output schema:
${JSON.stringify(outputSchema)}

CRITICAL!:
- ALWAYS Respond with a raw compact JSON array even if there is only one item.
- NEVER wrap it in markdown code fences or any other surrounding text.
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

    #logStart = (id: number, targetLocales: string[]) =>
        `${color.cyan(this.ai.name)}: ${color.cyan(this.sourceLocale)}..[${targetLocales.map(color.cyan).join(',')}] [${color.cyan(id)}]:`

    translate = async (batch: Batch, attempt = 0) => {
        const logStart = this.#logStart(batch.id, batch.targetLocales)
        let translated: OutputItem[] = []
        const inputItems: InputItem[] = []
        let plurals: Intl.LDMLPluralRule[] | null = null
        for (const item of batch.items) {
            const id = item.translations.get(this.sourceLocale)!
            inputItems.push({
                id,
                context: item.context,
                references: item.references,
            })
            if (id.length > 1) {
                plurals = batch.plurals
            }
        }
        try {
            const translatedstr = await this.ai.translate(
                JSON.stringify(inputItems),
                instruct(this.sourceLocale, batch.targetLocales, plurals),
            )
            translated = JSON.parse(translatedstr)
            if (Array.isArray(translated)) {
                translated = translated.slice(0, batch.items.length) // may return more
            } else {
                translated = []
            }
        } catch (err) {
            this.log.error(logStart, `error: ${err}`)
            return
        }
        const unTranslated: Item[] = batch.items.slice(translated.length)
        for (const [i, outItem] of translated.entries()) {
            const item = batch.items[i]!
            const id = item.translations.get(this.sourceLocale)!
            const sourceComp = compileTranslation(id)
            for (const loc of batch.targetLocales) {
                const translation = outItem[loc]
                if (translation === undefined) {
                    unTranslated.push(item)
                    break
                }
                const forms = typeof id === 'string' ? null : (plurals?.length ?? 0)
                if (!isEquivalent(sourceComp, compileTranslation(translation), forms)) {
                    unTranslated.push(item)
                    break
                }
                item.translations.set(loc, translation)
            }
        }
        if (unTranslated.length === 0) {
            this.log.info(logStart, color.green('translated'))
            return
        }
        attempt++
        if (attempt === MAX_RETRIES) {
            this.log.error(logStart, `Giving up after ${attempt} unsuccessful retries`)
            return
        }
        this.log.warn(logStart, color.cyan(unTranslated.length), 'items not translated. Retrying...')
        batch.items = unTranslated
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
        const group = this.ai.group[this.sourceLocale]
        const groups = new Set<string | string[]>()
        for (const item of items) {
            groups.clear()
            for (const [loc, transl] of item.translations.entries()) {
                if (loc === this.sourceLocale || transl[0]) {
                    continue
                }
                groups.add(group?.find(g => g.includes(loc)) ?? loc)
            }
            for (const groupKey of groups) {
                let groupItems = itemsByLocales.get(groupKey)
                if (groupItems == null) {
                    groupItems = []
                    itemsByLocales.set(groupKey, groupItems)
                }
                groupItems.push(item)
            }
        }
        return itemsByLocales
    }

    prepItemsInBatches = (itemsByGroup: Map<GroupKey, Item[]>) => {
        const opInfo: [string, Batch, number][] = []
        for (let [groupKey, items] of itemsByGroup) {
            const groupBatches = this.batches.get(groupKey) ?? []
            const lastBatch = groupBatches.at(-1)
            if (lastBatch && lastBatch.items.length < this.ai.batchSize) {
                const lastBatchFree = this.ai.batchSize - lastBatch.items.length
                const itemsToAdd = items.slice(0, lastBatchFree)
                opInfo.push(['(add)', lastBatch, itemsToAdd.length])
                lastBatch.items.push(...itemsToAdd)
                items = items.slice(lastBatchFree)
            }
            for (let i = 0; i < items.length; i += this.ai.batchSize) {
                const chunk = items.slice(i, i + this.ai.batchSize)
                const targetLocales = Array.isArray(groupKey) ? groupKey : [groupKey]
                const batch: Batch = {
                    id: this.nextBatchId,
                    targetLocales,
                    plurals: pluralForms(targetLocales[0]!),
                    items: chunk,
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
                this.#logStart(batch.id, batch.targetLocales),
                opType,
                'translate',
                color.cyan(msgsLen),
                'items',
            )
        }
        if (!this.running) {
            this.running = this.run()
        }
    }
}
