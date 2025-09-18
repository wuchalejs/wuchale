import PO from 'pofile'
import type { AI, ItemType } from './index.js'

const baseURL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='
const headers = {'Content-Type': 'application/json'}

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

function prepareData(fragments: ItemType[], instruction: string) {
    const po = new PO()
    po.items = fragments
    return {
        system_instruction: {
            parts: [{ text: instruction }]
        },
        contents: [{parts: [{text: po.toString()}]}]
    }
}

export function gemini(apiKey: string = 'env', batchLimit = 50): AI {
    if (apiKey === 'env') {
        apiKey = process.env.GEMINI_API_KEY
    }
    if (!apiKey) {
        return null
    }
    const url = `${baseURL}${apiKey}`
    return {
        name: 'Gemini',
        batchSize: batchLimit,
        translate: async (messages: ItemType[], instruction: string) => {
            const data = prepareData(messages, instruction)
            const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data) })
            const json: GeminiRes = await res.json()
            if (json.error) {
                throw new Error(`error: ${json.error.code} ${json.error.message}`)
            }
            const resText = json.candidates[0]?.content.parts[0].text
            return PO.parse(resText).items as any
        }
    }
}

export const defaultGemini = gemini()
