import { defaultGenerateLoadID, defaultHeuristic } from 'wuchale/adapters'
import { deepMergeObjects } from 'wuchale/config'
import { adapter as vanillaAdapter } from 'wuchale/adapter-vanilla'
import type {
    HeuristicFunc,
    Adapter,
    AdapterArgs,
    RuntimeOptions,
} from 'wuchale/adapters'
import { SvelteTransformer } from "./transformer.js"
import type { AdapterPassThruOpts } from 'wuchale/adapters'

const topLevelDeclarationsInside = ['$derived', '$derived.by']
const ignoreElements = ['style', 'path']

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
    runtime: {
        initInsideFunc: false,
        wrapInit: init => `$derived(${init})`,
        wrapExpr: expr => expr,
        initOnce: false,
    }
}

export const adapter = (args: AdapterArgs = defaultArgs): Adapter => {
    const {
        heuristic,
        pluralsFunc,
        runtime,
        ...rest
    } = deepMergeObjects(args, defaultArgs)
    return {
        transform: ({ content, filename, index, header }) => new SvelteTransformer(
            content,
            filename,
            index,
            heuristic,
            pluralsFunc,
            runtime as RuntimeOptions,
            header.expr
        ).transformSv(header.head),
        loaderExts: ['.svelte.js', '.svelte.ts', '.js', '.ts'],
        defaultLoaders: async dependencies => {
            const available = ['reactive', 'vanilla']
            if (dependencies.has('@sveltejs/kit')) {
                available.unshift('sveltekit')
            }
            return available
        },
        defaultLoaderPath: (loader: string) => {
            if (loader === 'vanilla') {
                return vanillaAdapter().defaultLoaderPath('vite')
            }
            return new URL(`../src/loaders/${loader}.svelte.js`, import.meta.url).pathname
        },
        ...rest as AdapterPassThruOpts
    }
}
