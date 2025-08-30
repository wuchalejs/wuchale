// $$ cd .. && npm run test

import { defaultGenerateLoadID, defaultHeuristic, deepMergeObjects } from 'wuchale'
import type {
    HeuristicFunc,
    Adapter,
    AdapterArgs,
    AdapterPassThruOpts,
    RuntimeConf,
} from 'wuchale'
import { SvelteTransformer } from "./transformer.js"
import { getDependencies } from 'wuchale/adapter-utils'

const topLevelDeclarationsInside = ['$derived', '$derived.by']
const ignoreElements = ['style', 'path']

const svelteHeuristic: HeuristicFunc = (msgStr, details) => {
    if (!defaultHeuristic(msgStr, details)) {
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
    runtime: {
        useReactive: ({file, funcName, additional}) => {
            const inTopLevel = funcName == null
            const inModule = file.endsWith('.svelte.js') || (additional as {module: boolean}).module
            return {
                init: inModule ? inTopLevel : (inTopLevel ? true : null),
                use: inModule ? inTopLevel : true,
            }
        },
        reactive: {
            importName: 'default',
            wrapInit: expr => `$derived(${expr})`,
            wrapUse: expr => expr,
        },
        plain: {
            importName: 'get',
            wrapInit: expr => expr,
            wrapUse: expr => expr,
        },
    },
}

export const adapter = (args: AdapterArgs = defaultArgs): Adapter => {
    const {
        heuristic,
        pluralsFunc,
        runtime,
        ...rest
    } = deepMergeObjects(args, defaultArgs)
    return {
        transform: ({ content, filename, index, expr }) => {
            return new SvelteTransformer(
                content,
                filename,
                index,
                heuristic,
                pluralsFunc,
                expr,
                runtime as RuntimeConf,
            ).transformSv()
        },
        loaderExts: ['.svelte.js', '.svelte.ts', '.js', '.ts'],
        defaultLoaders: async () => {
            if (rest.bundleLoad) {
                return ['bundle']
            }
            const deps = await getDependencies()
            const available = ['svelte']
            if (deps.has('@sveltejs/kit')) {
                available.unshift('sveltekit')
            }
            return available
        },
        defaultLoaderPath: loader => {
            if (loader === 'sveltekit') {
                return {
                    client: new URL(`../src/loaders/svelte.svelte.js`, import.meta.url).pathname,
                    ssr: new URL(`../src/loaders/sveltekit.ssr.svelte.js`, import.meta.url).pathname
                }
            }
            return new URL(`../src/loaders/${loader}.svelte.js`, import.meta.url).pathname
        },
        runtime,
        ...rest as Omit<AdapterPassThruOpts, 'runtime'>,
        docsUrl: 'https://wuchale.dev/adapters/svelte'
    }
}
