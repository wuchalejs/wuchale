// $$ cd .. && npm run test

import { defaultGenerateLoadID, defaultHeuristicFuncOnly } from '../adapters.js'
import { deepMergeObjects } from "../config.js"
import type {
    AdapterArgs,
    Adapter,
    AdapterPassThruOpts,
    RuntimeConf,
    CodePattern,
} from "../adapters.js"
import { Transformer } from "./transformer.js"
import { getDependencies, loaderPathResolver } from '../adapter-utils/index.js'

export { Transformer }
export { parseScript, scriptParseOptions, scriptParseOptionsWithComments } from './transformer.js'

export const pluralPattern: CodePattern = {
    name: 'plural',
    args: ['other', 'message', 'pluralFunc'],
}

const defaultArgs: AdapterArgs = {
    files: { include: 'src/**/*.{js,ts}', ignore: '**/*.d.ts' },
    catalog: './src/locales/{locale}',
    patterns: [pluralPattern],
    heuristic: defaultHeuristicFuncOnly,
    granularLoad: false,
    bundleLoad: false,
    generateLoadID: defaultGenerateLoadID,
    writeFiles: {},
    runtime: {
        useReactive: ({nested}) => ({
            init: nested ? null : false,
            use: nested ? null : false,
        }),
        plain: {
            importName: 'default',
            wrapInit: expr => expr,
            wrapUse: expr => expr,
        }
    }
}

const resolveLoaderPath = loaderPathResolver(import.meta.url, '../../src/adapter-vanilla/loaders', 'js')

export const adapter = (args: AdapterArgs = defaultArgs): Adapter => {
    const {
        heuristic,
        patterns,
        runtime,
        ...rest
    } = deepMergeObjects(args, defaultArgs)
    return {
        transform: ({ content, filename, index, expr }) => new Transformer(
            content,
            filename,
            index,
            heuristic,
            patterns,
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
                    server: resolveLoaderPath('vite.ssr'),
                }
            }
            return resolveLoaderPath(loader)
        },
        runtime,
        ...rest as Omit<AdapterPassThruOpts, 'runtime'>,
        docsUrl: 'https://wuchale.dev/adapters/vanilla'
    }
}
