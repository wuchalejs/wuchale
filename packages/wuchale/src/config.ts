import { resolve } from "node:path"
import { type Adapter } from "./adapters.js"

export type ConfigPartial = {
    sourceLocale?: string
    otherLocales?: string[]
    geminiAPIKey?: string,
    messages?: boolean,
}

export type Config = ConfigPartial & {
    adapters?: {[key: string]: Adapter}
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

export async function getConfig(configPath?: string): Promise<Config> {
    const importPath = (configPath && resolve(configPath)) ?? `${process.cwd()}/${configName}`
    const module = await import(importPath)
    return deepMergeObjects(module.default, defaultConfig)
}
