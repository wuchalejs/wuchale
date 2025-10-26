import { defaultGenerateLoadID, deepMergeObjects, createHeuristic, defaultHeuristicOpts } from 'wuchale'
import { pluralPattern, getDefaultLoaderPath as getDefaultLoaderPathVanilla } from 'wuchale/adapter-vanilla'
import type {
    HeuristicFunc,
    Adapter,
    AdapterArgs,
    AdapterPassThruOpts,
    RuntimeConf,
    LoaderChoice,
    CreateHeuristicOpts,
} from 'wuchale'
import { JSXTransformer, type JSXLib } from "./transformer.js"
import { loaderPathResolver } from 'wuchale/adapter-utils'

export function createJsxHeuristic(opts: CreateHeuristicOpts): HeuristicFunc {
    const defaultHeuristic = createHeuristic(opts)
    return msg => {
        if (!defaultHeuristic(msg)) {
            return false
        }
        if (msg.details.scope !== 'script') {
            return true
        }
        if (msg.details.declaring === 'variable') {
            return false
        }
        return true
    }
}

export const jsxDefaultHeuristic: HeuristicFunc = createJsxHeuristic(defaultHeuristicOpts)

type LoadersAvailable = 'default' | 'react' | 'solidjs'

type JSXArgs = AdapterArgs<LoadersAvailable> & {
    variant?: JSXLib
}

const defaultRuntime: RuntimeConf = {
    useReactive: ({funcName, nested}) => {
        const inTopLevel = funcName == null
        const insideReactive =  !inTopLevel && !nested && ((funcName.startsWith('use') && funcName.length > 3) || /[A-Z]/.test(funcName[0]))
        return {
            init: inTopLevel ? null : insideReactive,
            use: insideReactive
        }
    },
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
    useReactive: ({funcName}) => {
        const inTopLevel = funcName == null
        return {
            init: inTopLevel ? true : null, // init only in top level
            use: true, // always use reactive
        }
    },
    reactive: {
        wrapInit: expr => `() => ${expr}`,
        wrapUse: expr => `${expr}()`
    }
}

const defaultArgs: JSXArgs = {
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
    if (loader === 'default') {
        return getDefaultLoaderPathVanilla('bundle', bundle)
    }
    if (bundle) {
        loader += '.bundle'
    }
    return resolveLoaderPath(loader)
}

export const adapter = (args: JSXArgs = defaultArgs): Adapter => {
    let {
        heuristic,
        patterns,
        variant,
        runtime,
        loader,
        ...rest
    } = deepMergeObjects(args, defaultArgs)
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
        ...rest as Omit<AdapterPassThruOpts, 'runtime'>,
    }
}
