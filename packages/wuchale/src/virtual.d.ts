declare module 'virtual:wuchale/loader' {
    import type { CatalogModule } from './runtime.js'
    export function loadCatalog(locale: string): Promise<CatalogModule>
    export const fileID: string
}

declare module 'virtual:wuchale/loader/sync' {
    import type { CatalogModule } from './runtime.js'
    export function loadCatalog(locale: string): CatalogModule
    export const fileID: string
}

declare module 'virtual:wuchale/locales' {
    export const locales: {[locale: string]: string}
}
