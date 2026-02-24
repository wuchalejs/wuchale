// $$ cd .. && npm run test

import { loaderPathResolver } from '../adapter-utils/index.js'
import type { Adapter, AdapterArgs, CodePattern, LoaderChoice, RuntimeConf } from '../adapters.js'
import { defaultGenerateLoadID, defaultHeuristicFuncOnly } from '../adapters.js'
import { deepMergeObjects } from '../config.js'
import { pofile } from '../pofile.js'
import { Transformer } from './transformer.js'

export { Transformer }
export { parseScript, scriptParseOptions, scriptParseOptionsWithComments } from './transformer.js'

export const pluralPattern: CodePattern = {
    name: 'plural',
    args: ['other', 'message', 'pluralFunc'],
}

type LoadersAvailable = 'server' | 'vite'

export type VanillaArgs = AdapterArgs<LoadersAvailable>

export const defaultArgs: VanillaArgs = {
    files: { include: 'src/**/*.{js,ts}', ignore: '**/*.d.ts' },
    storage: pofile(),
    patterns: [pluralPattern],
    heuristic: defaultHeuristicFuncOnly,
    granularLoad: false,
    bundleLoad: false,
    generateLoadID: defaultGenerateLoadID,
    loader: 'vite',
    runtime: {
        initReactive: ({ nested }) => (nested ? null : false),
        useReactive: false,
        plain: {
            wrapInit: expr => expr,
            wrapUse: expr => expr,
        },
    },
}

const resolveLoaderPath = loaderPathResolver(import.meta.url, '../../src/adapter-vanilla/loaders', 'js')

export function getDefaultLoaderPath(loader: LoaderChoice<LoadersAvailable>, bundle: boolean) {
    if (loader === 'custom') {
        return null
    }
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

export const adapter = (args: Partial<VanillaArgs> = defaultArgs): Adapter => {
    const { heuristic, patterns, runtime, loader, ...rest } = deepMergeObjects(args, defaultArgs)
    return {
        transform: ({ content, filename, index, expr, matchUrl }) =>
            new Transformer(
                content,
                filename,
                index,
                heuristic,
                patterns,
                expr,
                runtime as RuntimeConf,
                matchUrl,
            ).transform(),
        loaderExts: ['.js', '.ts'],
        defaultLoaderPath: getDefaultLoaderPath(loader, rest.bundleLoad),
        runtime,
        ...rest,
    }
}
