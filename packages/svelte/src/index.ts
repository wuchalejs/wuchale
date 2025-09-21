import { defaultGenerateLoadID, defaultHeuristic, deepMergeObjects } from 'wuchale'
import type {
    HeuristicFunc,
    Adapter,
    AdapterArgs,
    AdapterPassThruOpts,
    RuntimeConf,
} from 'wuchale'
import { SvelteTransformer } from "./transformer.js"
import { getDependencies, loaderPathResolver } from 'wuchale/adapter-utils'

const topLevelDeclarationsInside = ['$derived', '$derived.by']

const svelteHeuristic: HeuristicFunc = (msgStr, details) => {
    if (!defaultHeuristic(msgStr, details)) {
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

const resolveLoaderPath = loaderPathResolver(import.meta.url, '../src/loaders', 'svelte.js')

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
                    client: resolveLoaderPath('svelte'),
                    ssr: resolveLoaderPath('sveltekit.ssr'),
                }
            }
            return resolveLoaderPath(loader)
        },
        runtime,
        ...rest as Omit<AdapterPassThruOpts, 'runtime'>,
        docsUrl: 'https://wuchale.dev/adapters/svelte'
    }
}
