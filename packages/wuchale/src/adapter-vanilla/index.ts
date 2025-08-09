// $$ cd .. && npm run test

import { glob } from "tinyglobby"
import { defaultGenerateLoadID, defaultHeuristicFuncOnly } from '../adapters.js'
import { deepMergeObjects } from "../config.js"
import type {
    AdapterArgs,
    Adapter,
    DataModuleFunc,
} from "../adapters.js"
import { Transformer, parseScript, scriptParseOptions, runtimeConst } from "./transformer.js"

export { Transformer, parseScript, scriptParseOptions, runtimeConst }

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

const dataModuleDev: DataModuleFunc = ({loadID: loadID, eventSend, eventReceive, compiled, plural}) => `
    export const p = ${plural}
    export const c = ${compiled}
    ${dataModuleHotUpdate(loadID, eventSend, eventReceive)}
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
        dataModuleDev,
        writeFiles,
        defaultLoaders: async () => {
            const available = ['default', 'vite']
            if ((await glob('vite.*')).length) {
                available.reverse()
            }
            return available
        },
        defaultLoaderPath: (loader: string) => {
            return new URL(`../src/loaders/${loader}.js`, import.meta.url).pathname
        },
    }
}
