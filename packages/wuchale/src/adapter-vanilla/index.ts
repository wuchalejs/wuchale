// $$ cd .. && npm run test

import { defaultGenerateLoadID, defaultHeuristicFuncOnly } from '../adapters.js'
import { deepMergeObjects } from "../config.js"
import type {
    AdapterArgs,
    Adapter,
    RuntimeOptions,
    AdapterPassThruOpts,
} from "../adapters.js"
import { Transformer } from "./transformer.js"
import { getDependencies } from '../adapter-utils/index.js'

export { Transformer }
export { parseScript, scriptParseOptions, scriptParseOptionsWithComments } from './transformer.js'

const defaultArgs: AdapterArgs = {
    files: { include: 'src/**/*.{js,ts}', ignore: '**/*.d.ts' },
    catalog: './src/locales/{locale}',
    pluralsFunc: 'plural',
    heuristic: defaultHeuristicFuncOnly,
    granularLoad: false,
    bundleLoad: false,
    generateLoadID: defaultGenerateLoadID,
    writeFiles: {},
    importName: '_w_load_',
    runtime: {
        initInScope: ({ funcName }) => funcName != null,
        wrapInit: init => init,
        wrapExpr: expr => expr,
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
        transform: ({ content, filename, index, header }) => new Transformer(
            content,
            filename,
            index,
            heuristic,
            pluralsFunc,
            runtime as RuntimeOptions,
            header.expr,
        ).transform(header.head),
        loaderExts: ['.js', '.ts'],
        defaultLoaders: async () => {
            if (rest.bundleLoad) {
                return ['bundle']
            }
            const deps = await getDependencies()
            const available = ['server']
            if (deps.has('vite')) {
                available.unshift('vite')
            }
            return available
        },
        defaultLoaderPath: (loader: string) => {
            return new URL(`../../src/adapter-vanilla/loaders/${loader}.js`, import.meta.url).pathname
        },
        ...rest as AdapterPassThruOpts,
    }
}
