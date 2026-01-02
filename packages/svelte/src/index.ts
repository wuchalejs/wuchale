import type { Adapter, AdapterArgs, CreateHeuristicOpts, HeuristicFunc, LoaderChoice, RuntimeConf } from 'wuchale'
import { createHeuristic, deepMergeObjects, defaultGenerateLoadID, defaultHeuristicOpts } from 'wuchale'
import { loaderPathResolver } from 'wuchale/adapter-utils'
import { pluralPattern } from 'wuchale/adapter-vanilla'
import { type RuntimeCtxSv, SvelteTransformer } from './transformer.js'

export type { RuntimeCtxSv }

export function createSvelteHeuristic(opts: CreateHeuristicOpts): HeuristicFunc {
    const defaultHeuristic = createHeuristic(opts)
    return (msg) => {
        const defRes = defaultHeuristic(msg)
        if (!defRes) {
            return false
        }
        if (msg.details.scope !== 'script') {
            return defRes
        }
        if (msg.details.call === '$inspect') {
            return false
        }
        return defRes
    }
}

/** Default Svelte heuristic which extracts top level variable assignments as well, leading to `$derived` being auto added when needed */
export const svelteDefaultHeuristic = createSvelteHeuristic(defaultHeuristicOpts)
export const svelteKitDefaultHeuristic = createSvelteHeuristic({ ...defaultHeuristicOpts, urlCalls: ['goto'] })

/** Default Svelte heuristic which requires `$derived` or `$derived.by` for top level variable assignments */
export const svelteDefaultHeuristicDerivedReq: HeuristicFunc = (msg) => {
    const defRes = svelteDefaultHeuristic(msg)
    if (!defRes) {
        return false
    }
    if (msg.details.scope !== 'script' || msg.details.declaring !== 'variable') {
        return defRes
    }
    if (!msg.details.topLevelCall) {
        return false
    }
    if (['$derived', '$derived.by'].includes(msg.details.topLevelCall)) {
        return defRes
    }
    return false
}

type LoadersAvailable = 'svelte' | 'sveltekit'

export type SvelteArgs = AdapterArgs<LoadersAvailable, RuntimeCtxSv>

const defaultArgs: SvelteArgs = {
    files: ['src/**/*.svelte', 'src/**/*.svelte.{js,ts}'],
    localesDir: './src/locales',
    patterns: [pluralPattern],
    heuristic: svelteKitDefaultHeuristic,
    granularLoad: false,
    bundleLoad: false,
    generateLoadID: defaultGenerateLoadID,
    loader: 'svelte',
    runtime: {
        initReactive: ({ file, funcName, module }) => {
            const inTopLevel = funcName == null
            return file.endsWith('.svelte.js') || module ? inTopLevel : inTopLevel ? true : null
        },
        useReactive: ({ file, funcName, module }) => {
            const inTopLevel = funcName == null
            return file.endsWith('.svelte.js') || module ? inTopLevel : true
        },
        reactive: {
            wrapInit: (expr) => `$derived(${expr})`,
            wrapUse: (expr) => expr,
        },
        plain: {
            wrapInit: (expr) => expr,
            wrapUse: (expr) => expr,
        },
    },
}

const resolveLoaderPath = loaderPathResolver(import.meta.url, '../src/loaders', 'svelte.js')

export function getDefaultLoaderPath(loader: LoaderChoice<LoadersAvailable>, bundle: boolean) {
    if (loader === 'custom') {
        return null
    }
    if (bundle) {
        return resolveLoaderPath('bundle')
    }
    if (loader === 'sveltekit') {
        return {
            client: resolveLoaderPath('svelte'),
            server: resolveLoaderPath('sveltekit.ssr'),
        }
    }
    return resolveLoaderPath(loader)
}

export const adapter = (args: Partial<SvelteArgs> = defaultArgs): Adapter => {
    const { heuristic, patterns, runtime, loader, ...rest } = deepMergeObjects(args, defaultArgs)
    return {
        transform: ({ content, filename, index, expr, matchUrl }) => {
            return new SvelteTransformer(
                content,
                filename,
                index,
                heuristic,
                patterns,
                expr,
                runtime as RuntimeConf<RuntimeCtxSv>,
                matchUrl,
            ).transformSv()
        },
        loaderExts: ['.svelte.js', '.svelte.ts', '.js', '.ts'],
        defaultLoaderPath: getDefaultLoaderPath(loader, rest.bundleLoad),
        runtime,
        ...rest,
    }
}
