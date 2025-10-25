// $$ cd .. && npm run test

import { defaultGenerateLoadID, defaultHeuristicFuncOnly } from '../adapters.js'
import { deepMergeObjects } from "../config.js"
import type {
    AdapterArgs,
    Adapter,
    AdapterPassThruOpts,
    RuntimeConf,
    CodePattern,
    LoaderChoice,
} from "../adapters.js"
import { Transformer } from "./transformer.js"
import { loaderPathResolver } from '../adapter-utils/index.js'

export { Transformer }
export { parseScript, scriptParseOptions, scriptParseOptionsWithComments } from './transformer.js'

export const pluralPattern: CodePattern = {
    name: 'plural',
    args: ['other', 'message', 'pluralFunc'],
}

type LoadersAvailable = 'bundle' | 'server' | 'vite'

const defaultArgs: AdapterArgs<LoadersAvailable> = {
    files: { include: 'src/**/*.{js,ts}', ignore: '**/*.d.ts' },
    localesDir: './src/locales',
    patterns: [pluralPattern],
    heuristic: defaultHeuristicFuncOnly,
    granularLoad: false,
    bundleLoad: false,
    generateLoadID: defaultGenerateLoadID,
    loader: 'vite',
    runtime: {
        useReactive: ({nested}) => ({
            init: nested ? null : false,
            use: nested ? null : false,
        }),
        plain: {
            wrapInit: expr => expr,
            wrapUse: expr => expr,
        }
    }
}

const resolveLoaderPath = loaderPathResolver(import.meta.url, '../../src/adapter-vanilla/loaders', 'js')

export function getDefaultLoaderPath(loader: LoaderChoice<LoadersAvailable>, bundle: boolean) {
    if (bundle) {
        return resolveLoaderPath('bundle')
    }
    if (loader === 'vite') {
        return {
            client: resolveLoaderPath('vite'),
            server: resolveLoaderPath('vite.ssr'),
        }
    }
    return resolveLoaderPath(loader)
}

export const adapter = (args: AdapterArgs<LoadersAvailable> = defaultArgs): Adapter => {
    const {
        heuristic,
        patterns,
        runtime,
        loader,
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
        defaultLoaderPath: getDefaultLoaderPath(loader, rest.bundleLoad),
        runtime,
        ...rest as Omit<AdapterPassThruOpts, 'runtime'>,
    }
}
