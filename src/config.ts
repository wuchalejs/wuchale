import { defaultHeuristic, type HeuristicFunc } from "./plugin/prep.js"

type LocaleConf = {
    name: string
    nPlurals?: number
    pluralRule?: string
}

export type GlobConf = string | {
    pattern: string[],
    ignore: string[],
}

export interface Config {
    sourceLocale?: string
    locales?: {[locale: string]: LocaleConf}
    localesDir?: string
    files?: GlobConf[],
    heuristic?: HeuristicFunc
    pluralFunc?: string
    hmr?: boolean
    geminiAPIKey?: string,
}

export const defaultOptions: Config = {
    sourceLocale: 'en',
    locales: {
        en: {
            name: 'English',
            nPlurals: 2,
            pluralRule: 'n == 1 ? 0 : 1',
        },
    },
    localesDir: './src/locales',
    files: ['src/**/*.svelte', 'src/**/*.svelte.js', 'src/**/*.svelte.ts'],
    heuristic: defaultHeuristic,
    pluralFunc: 'plural',
    hmr: true,
    geminiAPIKey: 'env',
}

function deepAssign(fromObj: object, toObj: object) {
    for (const [key, value] of Object.entries(fromObj)) {
        if (value === undefined) {
            delete toObj[key]
        }
        if (!value || Array.isArray(value) || typeof value !== 'object') {
            toObj[key] = value
            continue
        }
        // objects
        if (!toObj[key]) {
            toObj[key] = {}
        }
        deepAssign(fromObj[key], toObj[key])
    }
}

export function defineConfig(config: Config) {
    return config
}

export async function getOptions(codeOptions: Config = {}) {
    const options: Config = defaultOptions
    try {
        const module = await import(`${process.cwd()}/wuchale.config.js`)
        deepAssign(module.default, options)
    } catch {}
    deepAssign(codeOptions, options)
    return options
}
