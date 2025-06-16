// $$ node %f

const apiKeyEnv = process.env.GEMINI_API_KEY
const baseURL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='
const h = {'Content-Type': 'application/json'}

function prepareData(fragments, sourceLocale, targetLocale) {
    const instruction = `You will be given text fragments for a web app
        in the language with the code: '${sourceLocale}' and you have to
        translate them into the language with the code: '${targetLocale}',
        preserving any placeholders`
    return {
        system_instruction: {
            parts: [{ text: instruction }]
        },
        contents: [{parts: fragments.map(text => ({text}))}]
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
        console.log(JSON.stringify(json, null, 2))
        const content = json.candidates[0].content
        const trans = {}
        for (const [i, text] of content.parts[0].text.split('\n').entries()) {
            if (text.trim()) {
                trans[fragments[i]] = text
            }
        }
        return trans
    }
}

export default setupGemini
