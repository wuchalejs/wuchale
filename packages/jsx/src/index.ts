import type { Adapter, AdapterArgs, CreateHeuristicOpts, HeuristicFunc, LoaderChoice, RuntimeConf } from 'wuchale'
import { createHeuristic, deepMergeObjects, defaultGenerateLoadID, defaultHeuristicOpts } from 'wuchale'
import { loaderPathResolver } from 'wuchale/adapter-utils'
import { getDefaultLoaderPath as getDefaultLoaderPathVanilla, pluralPattern } from 'wuchale/adapter-vanilla'
import { type JSXLib, JSXTransformer } from './transformer.js'

export function createJsxHeuristic(opts: CreateHeuristicOpts): HeuristicFunc {
    const defaultHeuristic = createHeuristic(opts)
    return msg => {
        const defRes = defaultHeuristic(msg)
        if (!defRes) {
            return false
        }
        if (msg.details.scope !== 'script') {
            return defRes
        }
        if (msg.details.declaring === 'variable') {
            return false
        }
        return defRes
    }
}

export const jsxDefaultHeuristic: HeuristicFunc = createJsxHeuristic(defaultHeuristicOpts)

type LoadersAvailable = 'default' | 'react' | 'solidjs'

export type JSXArgs = AdapterArgs<LoadersAvailable> & {
    variant: JSXLib
}

const defaultRuntime: RuntimeConf = {
    initReactive: ({ funcName, nested }) => {
        const inTopLevel = funcName == null
        const insideReactive =
            !inTopLevel && !nested && ((funcName.startsWith('use') && funcName.length > 3) || /[A-Z]/.test(funcName[0]))
        return inTopLevel ? null : insideReactive
    },
    useReactive: ({ funcName, nested }) =>
        funcName != null &&
        !nested &&
        ((funcName.startsWith('use') && funcName.length > 3) || /[A-Z]/.test(funcName[0])),
    reactive: {
        wrapInit: expr => expr,
        wrapUse: expr => expr,
    },
    plain: {
        wrapInit: expr => expr,
        wrapUse: expr => expr,
    },
}

const defaultRuntimeSolid: RuntimeConf = {
    ...defaultRuntime,
    initReactive: ({ funcName }) => (funcName == null ? true : null), // init only in top level
    useReactive: true, // always reactive, because solidjs doesn't have a problem with it
    reactive: {
        wrapInit: expr => `() => ${expr}`,
        wrapUse: expr => `${expr}()`,
    },
}

export const defaultArgs: JSXArgs = {
    files: { include: 'src/**/*.{js,ts,jsx,tsx}', ignore: '**/*.d.ts' },
    localesDir: './src/locales',
    patterns: [pluralPattern],
    heuristic: jsxDefaultHeuristic,
    granularLoad: false,
    bundleLoad: false,
    loader: 'default',
    generateLoadID: defaultGenerateLoadID,
    runtime: defaultRuntime,
    variant: 'default',
}

const resolveLoaderPath = loaderPathResolver(import.meta.url, '../src/loaders', 'js')

export function getDefaultLoaderPath(loader: LoaderChoice<LoadersAvailable>, bundle: boolean) {
    if (loader === 'custom') {
        return null
    }
    if (loader === 'default') {
        return getDefaultLoaderPathVanilla('bundle', bundle)
    }
    if (bundle) {
        loader += '.bundle'
    }
    return resolveLoaderPath(loader)
}

export const adapter = (args: Partial<JSXArgs> = defaultArgs): Adapter => {
    let { heuristic, patterns, variant, runtime, loader, ...rest } = deepMergeObjects(args, defaultArgs)
    if (variant === 'solidjs' && args.runtime == null) {
        runtime = defaultRuntimeSolid
    }
    return {
        transform: ({ content, filename, index, expr, matchUrl }) => {
            return new JSXTransformer(
                content,
                filename,
                index,
                heuristic,
                patterns,
                expr,
                runtime as RuntimeConf,
                matchUrl,
            ).transformJx(variant)
        },
        loaderExts: ['.js', '.ts'],
        defaultLoaderPath: getDefaultLoaderPath(loader, rest.bundleLoad),
        runtime,
        getRuntimeVars: {
            reactive: 'useW_load_rx_',
        },
        ...rest,
    }
}
