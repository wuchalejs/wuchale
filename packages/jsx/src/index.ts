import { defaultGenerateLoadID, defaultHeuristic, deepMergeObjects } from 'wuchale'
import { adapter as vanillaAdapter } from 'wuchale/adapter-vanilla'
import type {
    HeuristicFunc,
    Adapter,
    AdapterArgs,
    RuntimeOptions,
    AdapterPassThruOpts,
} from 'wuchale'
import { JSXTransformer } from "./transformer.js"

const ignoreElements = ['style', 'path']

const jsxHeuristic: HeuristicFunc = (msgStr, details) => {
    if (!defaultHeuristic(msgStr, details)) {
        return false
    }
    if (ignoreElements.includes(details.element)) {
        return false
    }
    if (details.scope !== 'script') {
        return true
    }
    if (details.declaring === 'variable') {
        return false
    }
    return true
}

type JSXArgs = AdapterArgs & {
    variant?: "default" | "solidjs"
}

const defaultArgs: JSXArgs = {
    files: { include: 'src/**/*.{js,ts,jsx,tsx}', ignore: '**/*.d.ts' },
    catalog: './src/locales/{locale}',
    pluralsFunc: 'plural',
    heuristic: jsxHeuristic,
    granularLoad: false,
    bundleLoad: false,
    generateLoadID: defaultGenerateLoadID,
    writeFiles: {},
    importName: '_w_load_',
    runtime: {
        initInScope: ({ funcName }) => funcName != null,
        wrapInit: init => init,
        wrapExpr: expr => expr,
    },
    variant: 'default',
}

export const adapter = (args: JSXArgs = defaultArgs): Adapter => {
    const {
        heuristic,
        pluralsFunc,
        runtime,
        variant,
        ...rest
    } = deepMergeObjects(args, defaultArgs)
    return {
        transform: ({ content, filename, index, header }) => new JSXTransformer(
            content,
            filename,
            index,
            heuristic,
            pluralsFunc,
            runtime as RuntimeOptions,
            header.expr
        ).transformJx(header, variant === 'solidjs'),
        loaderExts: ['.js', '.ts'],
        defaultLoaders: dependencies => {
            const loaders = ['default']
            if (dependencies.has('react') || dependencies.has('preact')) {
                loaders.unshift('react')
            }
            if (dependencies.has('solid-js')) {
                loaders.unshift('solidjs')
            }
            return loaders
        },
        defaultLoaderPath: (loader: string) => {
            if (loader === 'default') {
                return vanillaAdapter().defaultLoaderPath('vite')
            }
            return new URL(`../src/loaders/${loader}.js`, import.meta.url).pathname
        },
        ...rest as AdapterPassThruOpts
    }
}
