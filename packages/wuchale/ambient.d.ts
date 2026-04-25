// these are substituted for default loaders
// this file exists to type check the loader templates

declare module '${PROXY}' {
    export const nLoadIDs: number
    export function loadCatalog(loadID: number, locale: string): Promise<import('wuchale/runtime').CatalogModule>
    export const patterns: import('wuchale').LoadGroupPatt[]
}

declare module '${PROXY_SYNC}' {
    export const nLoadIDs: number
    export function loadCatalog(loadID: number, locale: string): import('wuchale/runtime').CatalogModule
    export const patterns: import('wuchale').LoadGroupPatt[]
}

declare module '${DATA}' {
    export type Locale = 'en' | 'es' // just examples for type checking
    export const locales: [Locale, ...Locale[]]
}
