// these are substituted for default loaders

declare module '${PROXY}' {
    export function loadCatalog(loadID: string, locale: string): Promise<import('wuchale/runtime').CatalogModule>
    export const loadIDs: string[]
}

declare module '${PROXY_SYNC}' {
    export function loadCatalog(loadID: string, locale: string): import('wuchale/runtime').CatalogModule
    export const loadIDs: string[]
}

declare module '${DATA}' {
    export const sourceLocale: string
    export const otherLocales: string[]
    export const locales: string[]
}
