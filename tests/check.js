// $$ node %f
import {wuchale} from '../dist/index.js'

const config = { geminiAPIKey: null }

const configFromVite = {env: {PROD: null}, root: process.cwd()}

export async function getOutput(content) {
    const plug = await wuchale(config)
    await plug.configResolved(configFromVite)
    const { _translations: translations, _compiled: compiled } = plug
    const processed = await plug.transformHandler(content, process.cwd() + '/src/test.svelte')
    return { processed, translations, compiled }
}

// only for syntax highlighting
export const svelte = foo => foo.join('')

// const p = await getOutput(svelte`
// <i>Hola</i>
// <p>{plural(2, ['one', 'two', 'three'],)}</p>
// `)
//
// console.log(p.processed.code)
// console.log(Object.values(p.translations.en))
