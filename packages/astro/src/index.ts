import type { Adapter, AdapterArgs, CreateHeuristicOpts, HeuristicFunc, LoaderChoice, RuntimeConf } from 'wuchale'
import { createHeuristic, defaultGenerateLoadID, defaultHeuristicOpts, fillDefaults, pofile } from 'wuchale'
import { loaderPathResolver } from 'wuchale/adapter-utils'
import { pluralPattern } from 'wuchale/adapter-vanilla'
import { AstroTransformer } from './transformer.js'

export function createAstroHeuristic(opts: CreateHeuristicOpts): HeuristicFunc {
    const defaultHeuristic = createHeuristic(opts)
    return msg => {
        const defRes = defaultHeuristic(msg)
        if (!defRes) {
            return false
        }
        if (msg.details.scope !== 'script') {
            return defRes
        }
        if (msg.details.call?.startsWith('Astro.')) {
            return false
        }
        return defRes
    }
}

export const astroDefaultHeuristic = createAstroHeuristic(defaultHeuristicOpts)

type LoadersAvailable = 'default'

// astro is an SSR framework, omit irrelevant
export type AstroArgs = Omit<
    AdapterArgs<LoadersAvailable>,
    'bundleLoad' | 'granularLoad' | 'generateLoadID' | 'runtime'
>

export const defaultRuntime: RuntimeConf = {
    // Astro is SSR-only, so we use non-reactive runtime by default
    initReactive: ({ funcName }) => (funcName == null ? false : null), // Only init in top-level functions
    // Astro is SSR - always use non-reactive
    useReactive: () => false,
    reactive: {
        wrapInit: expr => expr,
        wrapUse: expr => expr,
    },
    plain: {
        wrapInit: expr => expr,
        wrapUse: expr => expr,
    },
}

export const defaultArgs: AstroArgs = {
    files: 'src/**/*.astro',
    storage: pofile(),
    patterns: [pluralPattern],
    heuristic: astroDefaultHeuristic,
    loader: 'default',
}

const resolveLoaderPath = loaderPathResolver(import.meta.url, '../src/loaders', 'js')

export function getDefaultLoaderPath(loader: LoaderChoice<LoadersAvailable>): string | null {
    if (loader === 'custom') {
        return null
    }
    // just 'default', so
    return resolveLoaderPath('astro')
}

export const adapter = (args: Partial<AstroArgs> = defaultArgs): Adapter => {
    const { heuristic, patterns, loader, ...rest } = fillDefaults(args, defaultArgs)
    return {
        transform: async ({ content, filename, index, expr, matchUrl }) => {
            return new AstroTransformer(
                content,
                filename,
                index,
                heuristic,
                patterns,
                expr,
                defaultRuntime,
                matchUrl,
            ).transformAs()
        },
        loaderExts: ['.js', '.ts'],
        defaultLoaderPath: getDefaultLoaderPath(loader),
        granularLoad: false,
        bundleLoad: false,
        generateLoadID: defaultGenerateLoadID,
        runtime: defaultRuntime,
        ...rest,
    }
}
