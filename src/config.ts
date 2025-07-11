import svelte from "./plugin/transform-svelte.js"
import { type TransformerType } from "./plugin/transform.js"

export type LocaleConf = {
    name: string
    nPlurals?: number
    pluralRule?: string
}

export type ConfigPartial = {
    sourceLocale?: string
    locales?: {[locale: string]: LocaleConf}
    geminiAPIKey?: string,
}

export type Config = ConfigPartial & {
    adapters?: TransformerType[]
    hmr?: boolean
}

export const defaultConfig: Config = {
    sourceLocale: 'en',
    locales: {
        en: {
            name: 'English',
            nPlurals: 2,
            pluralRule: 'n == 1 ? 0 : 1',
        },
    },
    adapters: [
        svelte({
            files: ['src/**/*.svelte', 'src/**/*.svelte.{js,ts}'],
            catalog: './src/locales/{locale}',
        })
    ],
    hmr: true,
    geminiAPIKey: 'env',
}

// dynamicKeysInside is mainly to fill plural rules for other languages with English
function deepAssign(fromObj: object, toObj: object, dynamicKeysInside: string[] = []) {
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
    for (const key of dynamicKeysInside) {
        const values = Object.values(toObj[key])
        const defaultValEntries = Object.entries(values[0])
        for (const val of values.slice(1)) {
            for (const [k, defaultVal] of defaultValEntries) {
                const v = val[k]
                if (v != null) {
                    continue
                }
                if (defaultVal == null) {
                    throw Error(`At least the first option in ${key} should have ${k}`)
                }
                val[k] = defaultVal
            }
        }
    }
}

export function defineConfig(config: Config) {
    return config
}

export async function getConfig(codeOptions: Config = {}) {
    const options: Config = defaultConfig
    try {
        const module = await import(`${process.cwd()}/wuchale.config.js`)
        deepAssign(module.default, options)
    } catch {}
    deepAssign(codeOptions, options, ['locales'])
    return options
}
