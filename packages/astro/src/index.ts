import type {
    Adapter,
    AdapterArgs,
    CreateHeuristicOpts,
    DeepPartial,
    HeuristicFunc,
    LoaderChoice,
    RuntimeConf,
} from 'wuchale'
import { createHeuristic, defaultHeuristicOpts, fillDefaults, pofile } from 'wuchale'
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
        if (msg.details.call?.startsWith('Astro.') || (msg.details.funcName == null && msg.details.exported)) {
            return false
        }
        return defRes
    }
}

export const astroDefaultHeuristic = createAstroHeuristic(defaultHeuristicOpts)

type LoadersAvailable = 'default'

// astro is an SSR framework, omit irrelevant
export type AstroArgs = Omit<AdapterArgs<LoadersAvailable>, 'loading' | 'runtime'>

export const defaultRuntime: RuntimeConf = {
    // Astro is SSR-only, so we use non-reactive runtime by default
    initReactive: ({ funcName, nested }) => (funcName == null || !nested ? false : null), // Only init in top-level and top-level functions
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

export const adapter = (args: DeepPartial<AstroArgs> = defaultArgs): Adapter => {
    const { heuristic, patterns, loader, ...rest } = fillDefaults(args, defaultArgs)
    return {
        transform: ctx => new AstroTransformer(ctx, heuristic, patterns, defaultRuntime).transformAs(),
        loaderExts: ['.js', '.ts'],
        defaultLoaderPath: getDefaultLoaderPath(loader),
        loading: {
            direct: false,
            granular: false,
            group: [],
        },
        runtime: defaultRuntime,
        ...rest,
    }
}
