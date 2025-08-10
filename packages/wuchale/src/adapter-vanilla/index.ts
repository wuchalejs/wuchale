// $$ cd .. && npm run test

import { defaultGenerateLoadID, defaultHeuristicFuncOnly } from '../adapters.js'
import { deepMergeObjects } from "../config.js"
import type {
    AdapterArgs,
    Adapter,
} from "../adapters.js"
import { Transformer } from "./transformer.js"

export { Transformer }
export { parseScript, scriptParseOptions, scriptParseOptionsWithComments } from './transformer.js'

export const dataModuleHotUpdate = (loadID: string | null, eventSend: string, eventReceive: string, targetVar = 'c') => `
    if (import.meta.hot) {
        import.meta.hot.on('${eventSend}', newData => {
            for (let i = 0; i < newData.length; i++) {
                if (JSON.stringify(${targetVar}[i]) !== JSON.stringify(newData[i])) {
                    ${targetVar}[i] = newData[i]
                }
            }
        })
        import.meta.hot.send('${eventReceive}'${loadID == null ? '' : `, {loadID: '${loadID}'}`})
    }
`

const defaultArgs: AdapterArgs = {
    files: { include: 'src/**/*.{js,ts}', ignore: '**/*.d.ts' },
    catalog: './src/locales/{locale}',
    pluralsFunc: 'plural',
    heuristic: defaultHeuristicFuncOnly,
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
        transform: ({content, filename, index, header}) => {
            return new Transformer(content, filename, index, heuristic, pluralsFunc, initInsideFunc ? header.expr : null).transform(header)
        },
        files,
        catalog,
        granularLoad,
        bundleLoad,
        generateLoadID,
        loaderExts: ['.js', '.ts'],
        writeFiles,
        defaultLoaders: async dependencies => {
            const available = ['server']
            if (dependencies.has('vite')) {
                available.unshift('vite')
            }
            return available
        },
        defaultLoaderPath: (loader: string) => {
            return new URL(`../../src/loaders/${loader}.js`, import.meta.url).pathname
        },
    }
}
