import { defaultGenerateLoadID, defaultHeuristic, deepMergeObjects } from 'wuchale'
import { pluralPattern, adapter as vanillaAdapter } from 'wuchale/adapter-vanilla'
import type {
    HeuristicFunc,
    Adapter,
    AdapterArgs,
    AdapterPassThruOpts,
    RuntimeConf,
} from 'wuchale'
import { JSXTransformer, type JSXLib } from "./transformer.js"
import { getDependencies, loaderPathResolver } from 'wuchale/adapter-utils'

const jsxHeuristic: HeuristicFunc = msg => {
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

type JSXArgs = AdapterArgs & {
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
        importName: 'default',
        wrapInit: expr => expr,
        wrapUse: expr => expr,
    },
    plain: {
        importName: 'get',
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
        importName: 'default',
        wrapInit: expr => `() => ${expr}`,
        wrapUse: expr => `${expr}()`
    }
}

const defaultArgs: JSXArgs = {
    files: { include: 'src/**/*.{js,ts,jsx,tsx}', ignore: '**/*.d.ts' },
    catalog: './src/locales/{locale}',
    patterns: [pluralPattern],
    heuristic: jsxHeuristic,
    granularLoad: false,
    bundleLoad: false,
    generateLoadID: defaultGenerateLoadID,
    writeFiles: {},
    runtime: defaultRuntime,
    variant: 'default',
}

const resolveLoaderPath = loaderPathResolver(import.meta.url, '../src/loaders', 'js')

export const adapter = (args: JSXArgs = defaultArgs): Adapter => {
    let {
        heuristic,
        patterns,
        variant,
        runtime,
        ...rest
    } = deepMergeObjects(args, defaultArgs)
    if (variant === 'solidjs' && args.runtime == null) {
        runtime = defaultRuntimeSolid
    }
    return {
        transform: ({ content, filename, index, expr }) => {
            return new JSXTransformer(
                content,
                filename,
                index,
                heuristic,
                patterns,
                expr,
                runtime as RuntimeConf,
            ).transformJx(variant)
        },
        loaderExts: ['.js', '.ts'],
        defaultLoaders: async () => {
            const deps = await getDependencies()
            const loaders = ['default']
            if (deps.has('react') || deps.has('preact')) {
                loaders.unshift('react')
            }
            if (deps.has('solid-js')) {
                loaders.unshift('solidjs')
            }
            return loaders
        },
        defaultLoaderPath: (loader: string) => {
            if (loader === 'default') {
                return vanillaAdapter({bundleLoad: rest.bundleLoad}).defaultLoaderPath('vite')
            }
            if (rest.bundleLoad) {
                loader += '.bundle'
            }
            return resolveLoaderPath(loader)
        },
        runtime,
        ...rest as Omit<AdapterPassThruOpts, 'runtime'>,
        docsUrl: 'https://wuchale.dev/adapters/jsx'
    }
}
