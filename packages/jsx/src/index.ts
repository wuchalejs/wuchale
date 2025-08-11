import { defaultGenerateLoadID, defaultHeuristic } from 'wuchale/adapters'
import { deepMergeObjects } from 'wuchale/config'
import type {
    HeuristicFunc,
    Adapter,
    AdapterArgs,
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
    initInsideFunc: true,
}

export const adapter = (args: AdapterArgs = defaultArgs): Adapter => {
    const {
        heuristic,
        pluralsFunc,
        files,
        catalog,
        granularLoad,
        bundleLoad,
        generateLoadID,
        writeFiles,
        initInsideFunc,
    } = deepMergeObjects(args, defaultArgs)
    return {
        transform: ({ content, filename, index, header }) => {
            const transformer = new JSXTransformer(content, filename, index, heuristic, pluralsFunc, initInsideFunc ? header.expr : null)
            return transformer.transformJx(header)
        },
        files,
        catalog,
        granularLoad,
        bundleLoad,
        generateLoadID,
        loaderExts: ['.js', '.ts'],
        writeFiles,
        defaultLoaders: async () => {
            const available = ['default']
            return available
        },
        defaultLoaderPath: (loader: string) => {
            return new URL(`../src/loaders/${loader}.js`, import.meta.url).pathname
        },
    }
}
