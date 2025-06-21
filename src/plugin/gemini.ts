// $$ cd .. && npm run test
// $$ node %f

import PO from 'pofile'

const baseURL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='
const h = {'Content-Type': 'application/json'}

function codeStandard(locale: string) {
    return `ISO 639-${locale.length === 2 ? 1 : 3}`
}

export type ItemType = InstanceType<typeof PO.Item>

function prepareData(fragments: ItemType[], sourceLocale: string, targetLocale: string) {
    const instruction = `
        You will be given the contents of a gettext .po file for a web app.
        Translate each of the items from the source to the target language.
        The source language ${codeStandard(sourceLocale)} code is: ${sourceLocale}.
        The target language ${codeStandard(targetLocale)} code is: ${targetLocale}.
        You can read all of the information for the items including contexts,
        comments and references to get the appropriate context about each item.
        Provide the translated fragments in the in the same order, preserving
        all placeholders.
        The placeholder format is like the following examples:
            - {0}: means arbitrary values.
            - <0>something</0>: means something enclosed in some tags, like HTML tags
            - <0/>: means a self closing tag, like in HTML
        In all of the examples, 0 is an example for any integer.
    `
    const po = new PO()
    po.items = fragments
    return {
        system_instruction: {
            parts: [{ text: instruction }]
        },
        contents: [{parts: [{text: po.toString()}]}]
    }
}

interface GeminiRes {
    candidates?: {
        content: {
            parts: { text: string }[]
        }
    }[]
}

function setupGemini(sourceLocale: string, targetLocale: string, apiKey: string | null) {
    if (apiKey === 'env') {
        apiKey = process.env.GEMINI_API_KEY
    }
    if (!apiKey) {
        return
    }
    const url = `${baseURL}${apiKey}`
    return async (fragments: ItemType[]) => {
        const data = prepareData(fragments, sourceLocale, targetLocale)
        const res = await fetch(url, {method: 'POST', headers: h, body: JSON.stringify(data)})
        const json: GeminiRes = await res.json()
        const resText = json.candidates[0]?.content.parts[0].text
        for (const [i, item] of PO.parse(resText).items.entries()) {
            if (item.msgstr[0]) {
                fragments[i].msgstr = item.msgstr
            }
        }
    }
}

export default setupGemini
