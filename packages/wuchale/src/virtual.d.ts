declare module 'virtual:wuchale/proxy' {
    export function loadCatalog(loadID: string, locale: string): Promise<import('wuchale/runtime').CatalogModule>
    export const loadIDs: string[]
    export const key: string
}

declare module 'virtual:wuchale/proxy/sync' {
    export function loadCatalog(loadID: string, locale: string): import('wuchale/runtime').CatalogModule
    export const loadIDs: string[]
    export const key: string
}

declare module 'virtual:wuchale/locales' {
    export const locales: {[locale: string]: string}
}

declare module 'virtual:wuchale/catalog/*' {
    const moduleExports: import('wuchale/runtime').CatalogModule
    export = moduleExports
}
