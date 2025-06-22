// $$ cd .. && npm run test
// $$ node %f

import PO from 'pofile'

const baseURL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='
const h = {'Content-Type': 'application/json'}

function codeStandard(locale: string) {
    return `ISO 639-${locale.length === 2 ? 1 : 3}`
}

export type ItemType = InstanceType<typeof PO.Item>

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

    batches: ItemType[][] = []
    running: Promise<void> | null = null
    sourceLocale: string
    targetLocale: string
    url: string
    instruction: string
    onComplete: () => Promise<void>

    constructor(sourceLocale: string, targetLocale: string, apiKey: string | null, onComplete: () => Promise<void>) {
        if (apiKey === 'env') {
            apiKey = process.env.GEMINI_API_KEY
        }
        if (!apiKey) {
            return
        }
        this.sourceLocale = sourceLocale
        this.targetLocale = targetLocale
        this.url = `${baseURL}${apiKey}`
        this.instruction = `
            You will be given the contents of a gettext .po file for a web app.
            Translate each of the items from the source to the target language.
            The source language ${codeStandard(this.sourceLocale)} code is: ${this.sourceLocale}.
            The target language ${codeStandard(this.targetLocale)} code is: ${this.targetLocale}.
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
    }

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

    async translate(fragments: ItemType[]) {
        const data = this.prepareData(fragments)
        const res = await fetch(this.url, {method: 'POST', headers: h, body: JSON.stringify(data)})
        const json: GeminiRes = await res.json()
        if (json.error) {
            console.error('Gemini error', json.error.code, json.error.message)
            return
        }
        const resText = json.candidates[0]?.content.parts[0].text
        for (const [i, item] of PO.parse(resText).items.entries()) {
            if (item.msgstr[0]) {
                fragments[i].msgstr = item.msgstr
            }
        }
    }

    * getBatches(): Generator<ItemType[], void, unknown> {
        while (this.batches.length > 0) {
            yield this.batches.pop() // order doesn't matter, because they are given by ref
        }
    }

    async run() {
        for (const batch of this.getBatches()) {
            await this.translate(batch)
        }
        await this.onComplete()
        this.running = null
    }

    add(items: ItemType[]): boolean {
        if (!this.url) {
            return
        }
        let newRequest = false
        if (this.batches.length > 0) {
            this.batches[0].push(...items)
        } else {
            this.batches.push(items)
            newRequest = true
        }
        if (!this.running) {
            this.running = this.run()
        }
        return newRequest
    }

}
