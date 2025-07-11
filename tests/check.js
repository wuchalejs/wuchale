// $$ node %f
import { AdapterHandler } from '../dist/plugin/handler.js'
import { IndexTracker } from '../dist/plugin/adapter.js'
import { defaultConfig } from '../dist/config.js'

export async function getOutput(content) {
    const handler = new AdapterHandler(
        defaultConfig.adapters[0],
        defaultConfig,
        new IndexTracker(),
        'test',
        process.cwd(),
    )
    await handler.init()
    const { code } = await handler.transform(content, 'src/test.svelte')
    const { translations, compiled } = handler
    return { code, translations, compiled }
}

// only for syntax highlighting
export const svelte = foo => foo.join('')

// const p = await getOutput(svelte`
// <i>Hola</i>
// <p>{plural(2, ['one', 'two', 'three'],)}</p>
// `)
// console.log(p.code)
// console.log(Object.values(p.translations.en))
