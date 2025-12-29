import { resolve } from "node:path"
import { type Adapter } from "./adapters.js"
import type { AI } from "./ai/index.js"
import { defaultGemini } from "./ai/gemini.js"
import type { LogLevel } from "./log.js"

export type ConfigPartial = {
    locales: string[]
    ai: AI | null
    logLevel: LogLevel
}

export type Config = ConfigPartial & {
    adapters: Record<string, Adapter>
    hmr: boolean
}

type ConfigWithOptional = Partial<Config>

export const defaultConfig: Config = {
    locales: [],
    adapters: {},
    hmr: true,
    ai: defaultGemini,
    logLevel: 'info',
}

function deepAssign<Type extends {}>(fromObj: Partial<Type>, toObj: Type) {
    for (const [key, value] of Object.entries(fromObj)) {
        if (value === undefined) {
            delete toObj[key]
        }
        if (!value || Array.isArray(value) || typeof value !== 'object') {
            toObj[key] = value
            continue
        }
        // objects
        if (!toObj[key] || Array.isArray(toObj[key]) || typeof toObj[key] !== 'object') {
            toObj[key] = {}
        }
        deepAssign(fromObj[key], toObj[key])
    }
}

export function defineConfig(config: ConfigWithOptional) {
    return config
}

export function deepMergeObjects<Type extends {}>(source: Partial<Type>, target: Type): Type {
    const full = { ...target }
    deepAssign(source, full)
    return full
}

export const defaultConfigNames = ['js', 'mjs', 'ts', 'mts'].map(ext => `wuchale.config.${ext}`)

const displayName = new Intl.DisplayNames(['en'], { type: 'language' })
export const getLanguageName = (code: string) => displayName.of(code) ?? code

export function checkValidLocale(locale: string) {
    try {
        getLanguageName(locale)
    } catch {
        throw new Error(`Invalid locale identifier: ${locale}`)
    }
}

export async function getConfig(configPath?: string): Promise<Config> {
    let module: { default: ConfigWithOptional } | null = null
    for (const confName of [configPath, ...defaultConfigNames]) {
        if (!confName) {
            continue
        }
        const fileUrl = `file://${resolve(confName)}`
        try {
            module = await import(fileUrl)
            break
        } catch (err) {
            if (err.code !== 'ERR_MODULE_NOT_FOUND' || err.url != fileUrl) {
                throw err
            }
        }
    }
    if (module == null) {
        throw new Error('Config file not found')
    }
    const config = deepMergeObjects(module.default, defaultConfig)
    for (const loc of config.locales) {
        checkValidLocale(loc)
    }
    return config
}
