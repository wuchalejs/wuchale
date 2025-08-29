// $$ cd .. && npm run test

import { defaultGenerateLoadID, defaultHeuristicFuncOnly } from '../adapters.js'
import { deepMergeObjects } from "../config.js"
import type {
    AdapterArgs,
    Adapter,
    AdapterPassThruOpts,
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
    runtime: {
        useReactive: () => ({
            init: false,
            use: false
        }),
        plain: {
            importName: 'default',
            wrapInit: expr => expr,
            wrapUse: expr => expr,
        }
    }
}

const resolveLoaderPath = (name: string) => new URL(`../../src/adapter-vanilla/loaders/${name}.js`, import.meta.url).pathname

export const adapter = (args: AdapterArgs = defaultArgs): Adapter => {
    const {
        heuristic,
        pluralsFunc,
        runtime,
        ...rest
    } = deepMergeObjects(args, defaultArgs)
    return {
        transform: ({ content, filename, index, expr }) => new Transformer(
            content,
            filename,
            index,
            heuristic,
            pluralsFunc,
            expr,
            runtime as RuntimeConf,
        ).transform(),
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
            if (loader === 'vite') {
                return {
                    client: resolveLoaderPath('vite'),
                    ssr: resolveLoaderPath('vite.ssr'),
                }
            }
            return resolveLoaderPath(loader)
        },
        runtime,
        ...rest as Omit<AdapterPassThruOpts, 'runtime'>,
        docsUrl: 'https://wuchale.dev/adapters/vanilla'
    }
}
