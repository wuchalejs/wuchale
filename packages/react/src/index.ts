import { defaultGenerateLoadID, defaultHeuristic } from 'wuchale/adapters'
import { deepMergeObjects } from 'wuchale/config'
import { dataModuleHotUpdate } from 'wuchale/adapter-vanilla'
import type {
    HeuristicFunc,
    Adapter,
    AdapterArgs,
    DataModuleFunc,
} from 'wuchale/adapters'
import { ReactTransformer } from "./transformer.js"

const ignoreElements = ['style', 'path']

const dataModuleDev: DataModuleFunc = ({ loadID, eventSend, eventReceive, compiled, plural }) => `
    export const p = ${plural}
    export const c = ${compiled}
    ${dataModuleHotUpdate(loadID, eventSend, eventReceive)}
`

const reactHeuristic: HeuristicFunc = (text, details) => {
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
    heuristic: reactHeuristic,
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
            const transformer = new ReactTransformer(content, filename, index, heuristic, pluralsFunc, initInsideFunc ? header.expr : null)
            return transformer.transformRe(header)
        },
        files,
        catalog,
        granularLoad,
        bundleLoad,
        generateLoadID,
        loaderExts: ['.js', '.ts'],
        dataModuleDev,
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
