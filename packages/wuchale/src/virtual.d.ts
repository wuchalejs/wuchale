declare module 'virtual:wuchale/loader' {
    export const fileIDs: string[]
    export function loadCatalog(fileID: string, locale: string): Promise<import('wuchale/runtime').CatalogModule>
}

declare module 'virtual:wuchale/loader/sync' {
    export function loadCatalog(fileID: string, locale: string): import('wuchale/runtime').CatalogModule
    export const fileIDs: string[]
}

declare module 'virtual:wuchale/locales' {
    export const locales: {[locale: string]: string}
}

declare module 'virtual:wuchale/catalog/*' {
    const moduleExports: import('wuchale/runtime').CatalogModule
    export = moduleExports
}
