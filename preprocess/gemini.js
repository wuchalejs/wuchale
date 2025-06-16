// $$ node %f

const apiKeyEnv = process.env.GEMINI_API_KEY
const baseURL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='
const h = {'Content-Type': 'application/json'}

function prepareData(fragments, sourceLocale, targetLocale) {
    const instruction = `You will be given text fragments for a web app.
        You have to find out the languages using their ISO 639-1 codes.
        Then translate each of the fragments from the source to the target.
        The source language is: ${sourceLocale}.
        The target language is: ${targetLocale}.
        preserve any placeholders and provide the translations line by line in the target language only.`
    return {
        system_instruction: {
            parts: [{ text: instruction }]
        },
        contents: [{parts: [{text: fragments.join('\n')}]}]
    }
}

function setupGemini(sourceLocale = 'en', targetLocale, apiKey) {
    apiKey ??= apiKeyEnv
    if (!apiKey) {
        return
    }
    const url = `${baseURL}${apiKey}`
    return async fragments => {
        const data = prepareData(fragments, sourceLocale, targetLocale)
        const res = await fetch(url, {method: 'POST', headers: h, body: JSON.stringify(data)})
        const json = await res.json()
        const resText = json.candidates[0].content.parts[0].text
        const trans = {}
        for (const [i, text] of resText.split('\n').entries()) {
            if (text.trim()) {
                trans[fragments[i]] = text
            }
        }
        return trans
    }
}

export default setupGemini
