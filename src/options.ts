import { defaultHeuristic, type HeuristicFunc } from "./plugin/prep.js"

export interface Options {
    sourceLocale?: string
    otherLocales?: string[]
    localesDir?: string
    heuristic?: HeuristicFunc
    hmr?: boolean
    geminiAPIKey?: string,
}

export const defaultOptions: Options = {
    sourceLocale: 'en',
    otherLocales: [],
    localesDir: './src/locales',
    heuristic: defaultHeuristic,
    hmr: true,
    geminiAPIKey: 'env',
}

function mergeOptions(fromOpt: Options, toOpt: Options) {
    for (const key of Object.keys(fromOpt)) {
        toOpt[key] = fromOpt[key]
    }
}

export async function getOptions(codeOptions: Options = {}) {
    const options: Options = defaultOptions
    try {
        const module = await import(process.cwd() + '/wuchale.config.js')
        mergeOptions(module.default, options)
    } catch {}
    mergeOptions(codeOptions, options)
    return options
}
