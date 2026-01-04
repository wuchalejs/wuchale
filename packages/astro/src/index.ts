import type { Adapter, AdapterArgs, CreateHeuristicOpts, HeuristicFunc, LoaderChoice, RuntimeConf } from 'wuchale'
import { createHeuristic, deepMergeObjects, defaultGenerateLoadID, defaultHeuristicOpts } from 'wuchale'
import { loaderPathResolver } from 'wuchale/adapter-utils'
import { pluralPattern } from 'wuchale/adapter-vanilla'
import { AstroTransformer } from './transformer.js'

/**
 * Create a heuristic function optimized for Astro files
 * Uses the default heuristic which handles translatable vs non-translatable strings
 */
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

/** Default Svelte heuristic which extracts top level variable assignments as well, leading to `$derived` being auto added when needed */
export const astroDefaultHeuristic = createAstroHeuristic(defaultHeuristicOpts)

type LoadersAvailable = 'default'

export type AstroArgs = AdapterArgs<LoadersAvailable>

const defaultRuntime: RuntimeConf = {
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

const defaultArgs: AstroArgs = {
    files: 'src/**/*.astro',
    localesDir: './src/locales',
    patterns: [pluralPattern],
    heuristic: astroDefaultHeuristic,
    granularLoad: false,
    bundleLoad: false,
    loader: 'default',
    generateLoadID: defaultGenerateLoadID,
    runtime: defaultRuntime,
}

const resolveLoaderPath = loaderPathResolver(import.meta.url, '../src/loaders', 'js')

export function getDefaultLoaderPath(loader: LoaderChoice<LoadersAvailable>, bundle: boolean): string | null {
    if (loader === 'custom') {
        return null
    }
    // just 'default', so
    let loaderName = 'astro'
    if (bundle) {
        loaderName += '.bundle'
    }
    return resolveLoaderPath(loaderName)
}

/**
 * Create an Astro adapter for wuchale
 *
 * @example
 * ```js
 * // wuchale.config.js
 * import { adapter as astro } from '@wuchale/astro'
 *
 * export default defineConfig({
 *   adapters: {
 *     astro: astro({ files: 'src/pages/**\/*.astro' })
 *   }
 * })
 * ```
 */
export const adapter = (args: Partial<AstroArgs> = {}): Adapter => {
    const { heuristic, patterns, runtime, loader, ...rest } = deepMergeObjects(args, defaultArgs)

    return {
        transform: async ({ content, filename, index, expr, matchUrl }) => {
            return new AstroTransformer(
                content,
                filename,
                index,
                heuristic,
                patterns,
                expr,
                runtime as RuntimeConf,
                matchUrl,
            ).transformAs()
        },
        loaderExts: ['.js', '.ts'],
        defaultLoaderPath: getDefaultLoaderPath(loader, rest.bundleLoad),
        runtime,
        ...rest,
    }
}
