import { resolve } from 'node:path'
import type { Adapter } from './adapters.js'
import { defaultGemini } from './ai/gemini.js'
import type { AI } from './ai/index.js'
import type { LogLevel } from './log.js'

export type ConfigPartial = {
    locales: [string, ...string[]]
    fallback: Record<string, string>
    localesDir: string
    ai: AI | null
    logLevel: LogLevel
}

export type Config = ConfigPartial & {
    adapters: Record<string, Adapter>
    hmr: boolean
}

export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends (infer A)[] // is array
        ? DeepPartial<A>[]
        : T[K] extends (...args: any[]) => any // is function
          ? T[K]
          : T[K] extends object
            ? DeepPartial<T[K]> // go deep on object
            : T[K]
}

type ConfigWithOptional = DeepPartial<Config>

export const defaultConfig: Config = {
    locales: ['en'],
    fallback: {},
    localesDir: 'src/locales',
    adapters: {},
    hmr: true,
    ai: defaultGemini,
    logLevel: 'info',
}

function deepFill(target: any, defaults: any) {
    for (const [key, def] of Object.entries(defaults)) {
        const value = target[key]
        if (Array.isArray(value)) {
            continue
        }
        if (!def || Array.isArray(def) || typeof def !== 'object') {
            if (value === undefined) {
                target[key] = def
            }
            continue
        }
        // def is an object. force prepare an object on the destination
        if (!value || typeof value !== 'object') {
            target[key] = {}
        }
        deepFill(target[key], def)
    }
}

/** mutates the target, and returns */
export function fillDefaults<T extends {}>(target: DeepPartial<T>, defaults: T): T {
    deepFill(target, defaults)
    return target as T
}

export function defineConfig(config: ConfigWithOptional) {
    return config
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
        } catch (err: any) {
            if (err.code !== 'ERR_MODULE_NOT_FOUND' || err.url !== fileUrl) {
                throw err
            }
        }
    }
    if (module == null) {
        throw new Error('Config file not found')
    }
    const config = fillDefaults(module.default, defaultConfig)
    for (const loc of config.locales) {
        checkValidLocale(loc)
    }
    return config
}
