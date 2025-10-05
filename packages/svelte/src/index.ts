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
import { pluralPattern } from 'wuchale/adapter-vanilla'

/** Default Svelte heuristic which extracts top level variable assignments as well, leading to `$derived` being auto added when needed */
export const svelteDefaultHeuristic: HeuristicFunc = msg => {
    if (!defaultHeuristic(msg)) {
        return false
    }
    if (msg.details.scope !== 'script') {
        return true
    }
    if (msg.details.call === '$inspect') {
        return false
    }
    return true
}

/** Default Svelte heuristic which requires `$derived` or `$derived.by` for top level variable assignments */
export const svelteDefaultHeuristicDerivedReq: HeuristicFunc = msg => {
    if (!svelteDefaultHeuristic(msg)) {
        return false
    }
    if (msg.details.scope !== 'script' || msg.details.declaring !== 'variable') {
        return true
    }
    if (!msg.details.topLevelCall) {
        return false
    }
    return ['$derived', '$derived.by'].includes(msg.details.topLevelCall)
}

const defaultArgs: AdapterArgs = {
    files: ['src/**/*.svelte', 'src/**/*.svelte.{js,ts}'],
    catalog: './src/locales/{locale}',
    patterns: [pluralPattern],
    heuristic: svelteDefaultHeuristic,
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
        patterns,
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
                patterns,
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
                    server: resolveLoaderPath('sveltekit.ssr'),
                }
            }
            return resolveLoaderPath(loader)
        },
        runtime,
        ...rest as Omit<AdapterPassThruOpts, 'runtime'>,
        docsUrl: 'https://wuchale.dev/adapters/svelte'
    }
}
