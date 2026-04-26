// these are substituted for default loaders
// this file exists to type check the loader templates

declare module '${PROXY}' {
    export function loadCatalog(loadID: number, locale: string): Promise<import('wuchale/runtime').CatalogModule>
    export const patterns: import('wuchale').AdapterPassThruOpts['loading']['group'][number][]
}

declare module '${PROXY_SYNC}' {
    export function loadCatalog(loadID: number, locale: string): import('wuchale/runtime').CatalogModule
    export const patterns: import('wuchale').AdapterPassThruOpts['loading']['group'][number][]
}

declare module '${DATA}' {
    export type Locale = 'en' | 'es' // just examples for type checking
    export const locales: [Locale, ...Locale[]]
}
