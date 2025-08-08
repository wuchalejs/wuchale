import { glob } from "tinyglobby"
import { defaultGenerateLoadID, defaultHeuristic } from 'wuchale/adapters'
import { deepMergeObjects } from 'wuchale/config'
import { dataModuleHotUpdate } from 'wuchale/adapter-vanilla'
import type {
    HeuristicFunc,
    Adapter,
    AdapterArgs,
    DataModuleFunc,
} from 'wuchale/adapters'
import { SvelteTransformer } from "./transformer.js"

const topLevelDeclarationsInside = ['$derived', '$derived.by']
const ignoreElements = ['style', 'path']

const dataModuleDev: DataModuleFunc = ({ loadID, eventSend, eventReceive, compiled, plural }) => `
    import { ReactiveArray } from '@wuchale/svelte/reactive'
    export const p = ${plural}
    export const c = new ReactiveArray(...${compiled})
    ${dataModuleHotUpdate(loadID, eventSend, eventReceive)}
`

const svelteHeuristic: HeuristicFunc = (text, details) => {
    if (!defaultHeuristic(text, details)) {
        return false
    }
    if (ignoreElements.includes(details.element)) {
        return false
    }
    if (details.scope !== 'script') {
        return true
    }
    if (details.declaring === 'variable' && !topLevelDeclarationsInside.includes(details.topLevelCall)) {
        return false
    }
    if (details.call === '$inspect') {
        return false
    }
    return true
}

const defaultArgs: AdapterArgs = {
    files: ['src/**/*.svelte', 'src/**/*.svelte.{js,ts}'],
    catalog: './src/locales/{locale}',
    pluralsFunc: 'plural',
    heuristic: svelteHeuristic,
    granularLoad: false,
    bundleLoad: false,
    generateLoadID: defaultGenerateLoadID,
    writeFiles: {},
    initInsideFunc: false,
}

export const adapter = (args: AdapterArgs = defaultArgs): Adapter => {
    const {
        heuristic,
        pluralsFunc,
        files,
        catalog,
        granularLoad,
        bundleLoad,
        generateLoadID,
        writeFiles,
        initInsideFunc,
    } = deepMergeObjects(args, defaultArgs)
    return {
        transform: ({ content, filename, index, header }) => {
            const transformer = new SvelteTransformer(content, filename, index, heuristic, pluralsFunc, initInsideFunc ? header.expr : null)
            return transformer.transformSv(header)
        },
        files,
        catalog,
        granularLoad,
        bundleLoad,
        generateLoadID,
        loaderExts: ['.svelte.js', '.svelte.ts'],
        dataModuleDev,
        writeFiles,
        defaultLoaders: async () => {
            const available = ['default', 'kit']
            if ((await glob('svelte.config.js')).length) {
                available.reverse()
            }
            return available
        },
        defaultLoaderPath: (loader: string) => {
            return new URL(`../src/loaders/${loader}.svelte.js`, import.meta.url).pathname
        },
    }
}
