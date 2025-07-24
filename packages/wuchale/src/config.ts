import { type Adapter } from "./adapters.js"

export type LocaleConf = {
    name: string
    nPlurals?: number
    plural?: string
}

export type ConfigPartial = {
    sourceLocale?: string
    locales?: {[locale: string]: LocaleConf}
    geminiAPIKey?: string,
    messages?: boolean,
}

export type Config = ConfigPartial & {
    adapters?: {[key: string]: Adapter}
    hmr?: boolean
}

export const defaultConfig: Config = {
    sourceLocale: 'en',
    locales: {
        en: {
            name: 'English',
            nPlurals: 2,
            plural: 'n == 1 ? 0 : 1',
        },
    },
    adapters: {},
    hmr: true,
    geminiAPIKey: 'env',
    messages: true,
}

// dynamicKeysInside is mainly to fill plural rules for other languages with English
function deepAssign<Type>(fromObj: Type, toObj: Type, dynamicKeysInside: string[] = []) {
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

export function deepMergeObjects<Type>(source: Type, target: Type, dynamicKeysInside?: string[]): Type {
    const full = {...target}
    deepAssign(source, full, dynamicKeysInside)
    return full
}

const configName = 'wuchale.config.js'

export async function getConfig(): Promise<Config> {
    const module = await import(`${process.cwd()}/${configName}`)
    return deepMergeObjects(module.default, defaultConfig, ['locales'])
}
