declare module 'virtual:wuchale/loader' {
    export const loadIDs: string[]
    export function loadCatalog(loadID: string, locale: string): Promise<import('wuchale/runtime').CatalogModule>
}

declare module 'virtual:wuchale/loader/sync' {
    export function loadCatalog(loadID: string, locale: string): import('wuchale/runtime').CatalogModule
    export const loadIDs: string[]
}

declare module 'virtual:wuchale/locales' {
    export const locales: {[locale: string]: string}
}

declare module 'virtual:wuchale/catalog/*' {
    const moduleExports: import('wuchale/runtime').CatalogModule
    export = moduleExports
}
