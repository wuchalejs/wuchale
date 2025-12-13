import type { AI } from './index.js'

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

function prepareData(content: string, instruction: string, think: boolean) {
    return {
        system_instruction: {
            parts: [{ text: instruction }]
        },
        contents: [{ parts: [{ text: content }] }],
        generationConfig: think ? undefined : {
            thinkingConfig: {
                thinkingBudget: 0
            }
        }
    }
}

type GeminiOpts = {
    apiKey?: string
    batchSize?: number
    think?: boolean
    parallel?: number
}

export function gemini({apiKey = 'env', batchSize = 50, think = false, parallel = 4}: GeminiOpts = {}): AI | null {
    if (apiKey === 'env') {
        apiKey = process.env.GEMINI_API_KEY ?? ''
    }
    if (!apiKey) {
        return null
    }
    return {
        name: 'Gemini',
        batchSize,
        parallel,
        translate: async (content: string, instruction: string) => {
            const data = prepareData(content, instruction, think)
            const res = await fetch(url, {
                method: 'POST',
                headers: {...headers, 'x-goog-api-key': apiKey},
                body: JSON.stringify(data)
            })
            const json = await res.json() as GeminiRes
            if (json.error) {
                throw new Error(`error: ${json.error.code} ${json.error.message}`)
            }
            return json.candidates?.[0]?.content.parts[0].text ?? ''
        },
    }
}

export const defaultGemini = gemini()
