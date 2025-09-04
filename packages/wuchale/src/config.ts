import { resolve } from "node:path"
import { type Adapter } from "./adapters.js"

export type ConfigPartial = {
    sourceLocale?: string
    otherLocales?: string[]
    geminiAPIKey?: string,
    messages?: boolean,
}

export type Config = ConfigPartial & {
    adapters?: Record<string, Adapter>
    hmr?: boolean
}

export const defaultConfig: Config = {
    sourceLocale: 'en',
    otherLocales: [],
    adapters: {},
    hmr: true,
    geminiAPIKey: 'env',
    messages: true,
}

function deepAssign<Type>(fromObj: Type, toObj: Type) {
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

export function deepMergeObjects<Type>(source: Type, target: Type): Type {
    const full = {...target}
    deepAssign(source, full)
    return full
}

export const configName = 'wuchale.config.js'

const displayName = new Intl.DisplayNames(['en'], {type: 'language'})
export const getLanguageName = (code: string) => displayName.of(code)

function checkValidLocale(locale: string) {
    try {
        getLanguageName(locale)
    } catch {
        throw new Error(`Invalid locale identifier: ${locale}`)
    }
}

export async function getConfig(configPath?: string): Promise<Config> {
    const importPath = (configPath && resolve(configPath)) ?? `${process.cwd()}/${configName}`
    const module = await import(`file://${importPath}`)
    const config = deepMergeObjects(<Config>module.default, defaultConfig)
    checkValidLocale(config.sourceLocale)
    for (const loc of config.otherLocales) {
        checkValidLocale(loc)
    }
    return config
}
