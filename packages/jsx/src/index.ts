import { defaultGenerateLoadID, defaultHeuristic } from 'wuchale/adapters'
import { deepMergeObjects } from 'wuchale/config'
import { adapter as vanillaAdapter } from 'wuchale/adapter-vanilla'
import type {
    HeuristicFunc,
    Adapter,
    AdapterArgs,
    RuntimeOptions,
    AdapterPassThruOpts,
} from 'wuchale/adapters'
import { JSXTransformer } from "./transformer.js"

const ignoreElements = ['style', 'path']

const jsxHeuristic: HeuristicFunc = (text, details) => {
    if (!defaultHeuristic(text, details)) {
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

const defaultArgs: AdapterArgs = {
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
        initInsideFunc: true,
        wrapInit: init => init,
        wrapExpr: expr => expr,
        initOnce: false,
    }
}

export const adapter = (args: AdapterArgs = defaultArgs): Adapter => {
    const {
        heuristic,
        pluralsFunc,
        runtime,
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
        ).transformJx(header),
        loaderExts: ['.js', '.ts'],
        defaultLoaders: () => {
            return ['default']
        },
        defaultLoaderPath: (loader: string) => {
            if (loader === 'default') {
                return vanillaAdapter().defaultLoaderPath('vite')
            }
        },
        ...rest as AdapterPassThruOpts
    }
}
