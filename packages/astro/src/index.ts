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
import { getFuncNameNested, loaderPathResolver } from 'wuchale/adapter-utils'
import { pluralPattern } from 'wuchale/adapter-vanilla'
import { AstroTransformer } from './transformer.js'

export function createAstroHeuristic(opts: CreateHeuristicOpts): HeuristicFunc {
    const defaultHeuristic = createHeuristic(opts)
    return (txt, file) => {
        const defRes = defaultHeuristic(txt, file)
        if (!defRes) {
            return false
        }
        const scopeType = txt.path.at(-1)?.type
        if (scopeType === 'attribute' || scopeType === 'element') {
            return defRes
        }
        if (txt.path.some(s => s.type === 'call' && s.name.startsWith('Astro.'))) {
            return false
        }
        const iExport = txt.path.findIndex(s => s.type === 'export')
        if (iExport !== -1 && !txt.path.slice(iExport).some(s => s.type === 'function' || s.type === 'funcexpr')) {
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
    initReactive: path => {
        const [funcName, nested] = getFuncNameNested(path)
        // Only init in top-level and top-level functions
        return funcName == null || !nested ? false : null
    },
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
