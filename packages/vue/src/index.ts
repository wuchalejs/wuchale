import type { Adapter, AdapterArgs, CreateHeuristicOpts, DeepPartial, HeuristicFunc, LoaderChoice } from 'wuchale'
import { createHeuristic, defaultHeuristicOpts, fillDefaults, pofile } from 'wuchale'
import { getFuncNameNested, loaderPathResolver } from 'wuchale/adapter-utils'
import { pluralPattern } from 'wuchale/adapter-vanilla'
import { VueTransformer } from './transformer.js'

export function createVueHeuristic(opts: CreateHeuristicOpts): HeuristicFunc {
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

/** Default Vue heuristic */
export const vueDefaultHeuristic = createVueHeuristic(defaultHeuristicOpts)

type LoadersAvailable = 'vue'

export type VueArgs = AdapterArgs<LoadersAvailable>

export const defaultArgs: VueArgs = {
    files: ['src/**/*.vue'],
    storage: pofile(),
    patterns: [pluralPattern],
    heuristic: vueDefaultHeuristic,
    loading: {
        direct: false,
        granular: false,
        group: [],
    },
    loader: 'vue',
    runtime: {
        initReactive: path => {
            const [funcName] = getFuncNameNested(path)
            const inTopLevel = funcName == null
            return inTopLevel ? true : null
        },
        useReactive: path => {
            return true
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

const resolveLoaderPath = loaderPathResolver(import.meta.url, '../src/loaders', 'js')

export function getDefaultLoaderPath(loader: LoaderChoice<LoadersAvailable>, bundle: boolean) {
    if (loader === 'custom') {
        return null
    }
    if (bundle) {
        return resolveLoaderPath('bundle')
    }
    return resolveLoaderPath(loader)
}

export const adapter = (args: DeepPartial<VueArgs> = defaultArgs): Adapter => {
    const { heuristic, patterns, runtime, loader, ...rest } = fillDefaults(args, defaultArgs)
    const rtComponentFile = '@wuchale/vue/runtime.vue'
    return {
        transform: ctx => new VueTransformer(ctx, heuristic, patterns, runtime).transformSv(rtComponentFile),
        loaderExts: ['.js', '.ts'],
        defaultLoaderPath: getDefaultLoaderPath(loader, rest.loading.direct),
        addImports: [rtComponentFile],
        runtime,
        ...rest,
    }
}
