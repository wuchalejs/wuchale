import PO from 'pofile'
import type { AI, ItemType } from './index.js'

const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
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

function prepareData(fragments: ItemType[], instruction: string, think: boolean) {
    const po = new PO()
    po.items = fragments
    return {
        system_instruction: {
            parts: [{ text: instruction }]
        },
        contents: [{ parts: [{ text: po.toString() }] }],
        generationConfig: think ? undefined : {
            thinkingConfig: {
                thinkingBudget: 0
            }
        }
    }
}

type GeminiOpts = {
    apiKey?: string
    batchLimit?: number
    think?: boolean
}

export function gemini({apiKey = 'env', batchLimit = 50, think = false}: GeminiOpts = {}): AI {
    if (apiKey === 'env') {
        apiKey = process.env.GEMINI_API_KEY
    }
    if (!apiKey) {
        return null
    }
    return {
        name: 'Gemini',
        batchSize: batchLimit,
        translate: async (messages: ItemType[], instruction: string) => {
            const data = prepareData(messages, instruction, think)
            const res = await fetch(url, {
                method: 'POST',
                headers: {...headers, 'x-goog-api-key': apiKey},
                body: JSON.stringify(data)
            })
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
