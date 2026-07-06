import type {
    Adapter,
    AdapterArgs,
    CreateHeuristicOpts,
    DecideReactiveDetails,
    DeepPartial,
    HeuristicFunc,
    LoaderChoice,
} from 'wuchale'
import { createHeuristic, defaultHeuristicOpts, fillDefaults, pofile } from 'wuchale'
import { loaderPathResolver } from 'wuchale/adapter-utils'
import { pluralPattern } from 'wuchale/adapter-vanilla'
import { type RuntimeCtxSv, SvelteTransformer } from './transformer.js'

export type { RuntimeCtxSv }

export function createSvelteHeuristic(opts: CreateHeuristicOpts): HeuristicFunc {
    const defaultHeuristic = createHeuristic(opts)
    return (txt, file) => {
        for (const s of txt.path) {
            if (s.type === 'call' && s.name === '$inspect') {
                return false
            }
        }
        return defaultHeuristic(txt, file)
    }
}

/** Default Svelte heuristic which extracts top level variable assignments as well, leading to `$derived` being auto added when needed */
export const svelteDefaultHeuristic = createSvelteHeuristic(defaultHeuristicOpts)
export const svelteKitDefaultHeuristic = createSvelteHeuristic({
    ...defaultHeuristicOpts,
    urlCalls: ['asset', 'goto', 'pushState', 'replaceState', 'resolve'],
})

type LoadersAvailable = 'svelte' | 'sveltekit'

export type SvelteArgs = AdapterArgs<LoadersAvailable>

type DecideRxDetails = DecideReactiveDetails<RuntimeCtxSv>

export const defaultArgs: SvelteArgs = {
    files: ['src/**/*.svelte', 'src/**/*.svelte.{js,ts}'],
    storage: pofile(),
    patterns: [pluralPattern],
    heuristic: svelteDefaultHeuristic,
    loading: {
        direct: false,
        granular: false,
        group: [],
    },
    loader: 'svelte',
    runtime: {
        initReactive: ({ file, funcName, ctx: { module } }: DecideRxDetails) => {
            const inTopLevel = funcName == null
            return file.endsWith('.svelte.js') || module ? inTopLevel : inTopLevel ? true : null
        },
        useReactive: ({ file, funcName, ctx: { module } }: DecideRxDetails) => {
            const inTopLevel = funcName == null
            return file.endsWith('.svelte.js') || module ? inTopLevel : true
        },
        reactive: {
            wrapInit: expr => `$derived(${expr})`,
            wrapUse: expr => expr,
        },
        plain: {
            wrapInit: expr => expr,
            wrapUse: expr => expr,
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

export const adapter = (args: DeepPartial<SvelteArgs> = defaultArgs): Adapter => {
    if (args.loader === 'sveltekit' && args.heuristic == null) {
        args.heuristic = svelteKitDefaultHeuristic
    }
    const { heuristic, patterns, runtime, loader, ...rest } = fillDefaults(args, defaultArgs)
    return {
        transform: ctx => new SvelteTransformer(ctx, heuristic, patterns, runtime).transformSv(),
        loaderExts: ['.svelte.js', '.svelte.ts', '.js', '.ts'],
        defaultLoaderPath: getDefaultLoaderPath(loader, rest.loading.direct),
        runtime,
        ...rest,
    }
}
