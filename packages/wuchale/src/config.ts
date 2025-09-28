import { resolve } from "node:path"
import { type Adapter } from "./adapters.js"
import type { AI } from "./ai/index.js"
import { defaultGemini } from "./ai/gemini.js"

export type LogLevel = 'error' | 'warn' | 'info' | 'verbose'

export type ConfigPartial = {
    sourceLocale?: string
    otherLocales?: string[]
    ai?: AI
    logLevel?: LogLevel
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
    ai: defaultGemini,
    logLevel: 'info',
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
    const full = { ...target }
    deepAssign(source, full)
    return full
}

export const defaultConfigNames = ['js', 'mjs'].map(ext => `wuchale.config.${ext}`)

const displayName = new Intl.DisplayNames(['en'], { type: 'language' })
export const getLanguageName = (code: string) => displayName.of(code)

function checkValidLocale(locale: string) {
    try {
        getLanguageName(locale)
    } catch {
        throw new Error(`Invalid locale identifier: ${locale}`)
    }
}

export async function getConfig(configPath?: string): Promise<Config> {
    let module: { default: Config }
    for (const confName of [configPath, ...defaultConfigNames]) {
        if (!confName) {
            continue
        }
        try {
            module = await import(`file://${resolve(confName)}`)
            break
        } catch (err) {
            if (err.code !== 'ERR_MODULE_NOT_FOUND') {
                throw err
            }
        }
    }
    const config = deepMergeObjects(module.default, defaultConfig)
    checkValidLocale(config.sourceLocale)
    for (const loc of config.otherLocales) {
        checkValidLocale(loc)
    }
    return config
}
