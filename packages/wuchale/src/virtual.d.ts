declare module 'virtual:wuchale/loader' {
    import type { CatalogModule } from './runtime.js'
    export const fileIDs: string[]
    export function loadCatalog(fileID: string, locale: string): Promise<CatalogModule>
}

declare module 'virtual:wuchale/loader/sync' {
    import type { CatalogModule } from './runtime.js'
    export function loadCatalog(fileID: string, locale: string): CatalogModule
    export const fileIDs: string[]
}

declare module 'virtual:wuchale/locales' {
    export const locales: {[locale: string]: string}
}
