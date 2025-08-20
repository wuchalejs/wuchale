import { defaultGenerateLoadID, defaultHeuristic, deepMergeObjects } from 'wuchale'
import { adapter as vanillaAdapter } from 'wuchale/adapter-vanilla'
import type {
    HeuristicFunc,
    Adapter,
    AdapterArgs,
    AdapterPassThruOpts,
} from 'wuchale'
import { initCatalogStmt, JSXTransformer, type JSXLib } from "./transformer.js"
import { getDependencies } from 'wuchale/adapter-utils'

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
    variant?: JSXLib
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
    variant: 'default',
}

export const adapter = (args: JSXArgs = defaultArgs): Adapter => {
    const {
        heuristic,
        pluralsFunc,
        variant,
        ...rest
    } = deepMergeObjects(args, defaultArgs)
    return {
        transform: ({ content, filename, index, header, mode }) => {
            const {importLine, stmt} = initCatalogStmt(header.expr, mode, variant)
            return new JSXTransformer(
                content,
                filename,
                index,
                heuristic,
                pluralsFunc,
                stmt,
            ).transformJx(`${importLine}\n${header.head}`, variant)
        },
        loaderExts: ['.js', '.ts'],
        defaultLoaders: async () => {
            const deps = await getDependencies()
            const loaders = ['default']
            if (deps.has('react') || deps.has('preact')) {
                loaders.unshift('react')
            }
            if (deps.has('solid-js')) {
                loaders.unshift('solidjs')
            }
            return loaders
        },
        defaultLoaderPath: (loader: string) => {
            if (loader === 'default') {
                return vanillaAdapter({bundleLoad: rest.bundleLoad}).defaultLoaderPath('vite')
            }
            if (rest.bundleLoad) {
                loader += '.bundle'
            }
            return new URL(`../src/loaders/${loader}.js`, import.meta.url).pathname
        },
        ...rest as AdapterPassThruOpts,
        docsUrl: 'https://wuchale.dev/adapters/jsx'
    }
}
