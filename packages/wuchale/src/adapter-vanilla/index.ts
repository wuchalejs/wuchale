// $$ cd .. && npm run test

import { defaultGenerateLoadID, defaultHeuristicFuncOnly } from '../adapters.js'
import { deepMergeObjects } from "../config.js"
import type {
    AdapterArgs,
    Adapter,
    AdapterPassThruOpts,
    CatalogConf,
    RuntimeConf,
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
    getCatalog: {
        reactiveImport: null,
        plainImport: 'default',
        useReactive: () => false,
        wrapInit: expr => expr,
    },
    runtime: {
        wrapInit: expr => expr,
        wrapUse: expr => expr,
    }
}

export const adapter = (args: AdapterArgs = defaultArgs): Adapter => {
    const {
        heuristic,
        pluralsFunc,
        getCatalog,
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
            header.expr,
            getCatalog as CatalogConf,
            runtime as RuntimeConf,
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
        docsUrl: 'https://wuchale.dev/adapters/vanilla'
    }
}
