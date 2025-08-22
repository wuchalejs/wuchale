import { defaultGenerateLoadID, defaultHeuristic, deepMergeObjects } from 'wuchale'
import { initRuntimeStmt, adapter as vanillaAdapter } from 'wuchale/adapter-vanilla'
import type {
    HeuristicFunc,
    Adapter,
    AdapterArgs,
    AdapterPassThruOpts,
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
}

export const adapter = (args: AdapterArgs = defaultArgs): Adapter => {
    const {
        heuristic,
        pluralsFunc,
        ...rest
    } = deepMergeObjects(args, defaultArgs)
    return {
        transform: ({ content, filename, index, header }) => {
            return new SvelteTransformer(
                content,
                filename,
                index,
                heuristic,
                pluralsFunc,
                initRuntimeStmt(header.expr),
            ).transformSv(header.head, header.expr)
        },
        loaderExts: ['.svelte.js', '.svelte.ts', '.js', '.ts'],
        defaultLoaders: async () => {
            if (rest.bundleLoad) {
                return ['bundle']
            }
            const deps = await getDependencies()
            const available = ['reactive', 'vanilla']
            if (deps.has('@sveltejs/kit')) {
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
        ...rest as AdapterPassThruOpts,
        docsUrl: 'https://wuchale.dev/adapters/svelte'
    }
}
