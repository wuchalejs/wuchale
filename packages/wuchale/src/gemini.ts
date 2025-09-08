// $$ cd .. && npm run test
// $$ node %f

import PO from 'pofile'
import { color, type Logger } from './log.js'

const baseURL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='
const h = {'Content-Type': 'application/json'}
const batchLimit = 50

export type ItemType = InstanceType<typeof PO.Item>

type Batch = {
    id: number
    messages: ItemType[]
}

interface GeminiRes {
    error?: {
        code: number,
        message: string,
    },
    candidates?: {
        content: {
            parts: { text: string }[]
        }
    }[]
}

// implements a queue for a sequential translation useful for vite's transform during dev
// as vite can do async transform
export default class GeminiQueue {

    batches: Batch[] = []
    nextBatchId: number = 0
    running: Promise<void> | null = null
    sourceLang: string
    targetLang: string
    url: string
    instruction: string
    onComplete: () => Promise<void>
    log: Logger

    constructor(sourceLang: string, targetLang: string, apiKey: string | null, onComplete: () => Promise<void>, log: Logger) {
        if (apiKey === 'env') {
            apiKey = process.env.GEMINI_API_KEY
        }
        if (!apiKey) {
            return
        }
        this.sourceLang = sourceLang
        this.targetLang = targetLang
        this.url = `${baseURL}${apiKey}`
        this.instruction = `
            You will be given the contents of a gettext .po file for a web app.
            Translate each of the items from ${this.sourceLang} to ${this.targetLang}.
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
        this.onComplete = onComplete
        this.log = log
    }

    #requestName = (id: number) => `${color.cyan('Gemini')}: ${this.targetLang} [${id}]`

    prepareData(fragments: ItemType[]) {
        const po = new PO()
        po.items = fragments
        return {
            system_instruction: {
                parts: [{ text: this.instruction }]
            },
            contents: [{parts: [{text: po.toString()}]}]
        }
    }

    async translate(batch: Batch) {
        const data = this.prepareData(batch.messages)
        const res = await fetch(this.url, {method: 'POST', headers: h, body: JSON.stringify(data)})
        const json: GeminiRes = await res.json()
        const logStart = this.#requestName(batch.id)
        if (json.error) {
            this.log.log(`${logStart}: ${color.red(`error: ${json.error.code} ${json.error.message}`)}`)
            return
        }
        const resText = json.candidates[0]?.content.parts[0].text
        const translated = PO.parse(resText).items
        let unTranslated: ItemType[] = batch.messages.slice(translated.length)
        for (const [i, item] of translated.entries()) {
            if (item.msgid !== batch.messages[i]?.msgid) {
                unTranslated.push(item)
                continue
            }
            if (item.msgstr[0]) {
                batch.messages[i].msgstr = item.msgstr
            } else {
                unTranslated.push(item)
            }
        }
        if (unTranslated.length) {
            this.log.log(`${logStart}: ${unTranslated.length} ${color.yellow('items not translated. Retrying...')}`)
            await this.translate({id: batch.id, messages: unTranslated})
        } else {
            this.log.log(`${logStart}: ${color.green('translated')}`)
        }
    }

    async run() {
        while (this.batches.length > 0) {
            const b = this.batches.pop()
            await this.translate(b)
        }
        await this.onComplete()
        this.running = null
    }

    add(messages: ItemType[]) {
        if (!this.url) {
            return
        }
        const lastBatch = this.batches.at(-1)
        let opType: string
        let batchId: number
        if (lastBatch && lastBatch.messages.length < batchLimit) {
            opType = color.green('(add)')
            batchId = lastBatch.id
            lastBatch.messages.push(...messages)
        } else {
            batchId = this.nextBatchId
            opType = color.yellow('(new)')
            this.batches.push({id: this.nextBatchId, messages})
            this.nextBatchId++
        }
        this.log.log(`${this.#requestName(batchId)}: ${opType} translate ${color.cyan(messages.length)} messages`)
        if (!this.running) {
            this.running = this.run()
        }
    }

}
