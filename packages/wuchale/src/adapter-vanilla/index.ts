// $$ cd .. && npm run test

import { loaderPathResolver } from '../adapter-utils/index.js'
import type { Adapter, AdapterArgs, CodePattern, LoaderChoice } from '../adapters.js'
import { type DeepPartial, fillDefaults } from '../config.js'
import { pofile } from '../pofile.js'
import { defaultHeuristicFuncOnly } from '../text.js'
import { Transformer } from './transformer.js'

export { parseScript, scriptParseOptions, scriptParseOptionsWithComments } from './transformer.js'
export { Transformer }

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
    loading: {
        direct: false,
        granular: false,
        group: [],
    },
    loader: 'vite',
    runtime: {
        initReactive: ({ nested }) => (nested ? null : false),
        useReactive: false,
        plain: {
            wrapInit: expr => expr,
            wrapUse: expr => expr,
        },
        reactive: {
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

export const adapter = (args: DeepPartial<VanillaArgs> = defaultArgs): Adapter => {
    const { heuristic, patterns, runtime, loader, ...rest } = fillDefaults(args, defaultArgs)
    return {
        transform: ctx => new Transformer(ctx, heuristic, patterns, runtime).transform(),
        loaderExts: ['.js', '.ts'],
        defaultLoaderPath: getDefaultLoaderPath(loader, rest.loading.direct),
        runtime,
        ...rest,
    }
}
