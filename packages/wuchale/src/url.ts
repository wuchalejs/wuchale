import { compile, match } from "path-to-regexp"

export type URLManifestItem = [
    string, // pattern
    [string, string][] // locale, localizedPath
]

export type URLManifest = URLManifestItem[]

type GetLocale = (url: URL, locales: string[]) => string | null

const getLocaleDefault: GetLocale = (url, locales) => {
    const iSecondSlash = url.pathname.indexOf('/', 2)
    const locale = url.pathname.slice(1, iSecondSlash)
    if (locales.includes(locale)) {
        return locale
    }
    return null
}

export function URLMatcher(manifest: URLManifest, locales: string[], getLocale: GetLocale = getLocaleDefault) {
    return (url: URL) => {
        const locale = getLocale(url, locales)
        for (const [pattern, localized] of manifest) {
            for (const [loc, path] of localized) {
                if (locale != null && locale !== loc) {
                    continue
                }
                const matched = match(path, {decode: false})(url.pathname)
                if (!matched) {
                    continue
                }
                const compiled = compile(pattern, {encode: false})
                return {path: compiled(matched.params), locale}
            }
        }
        return {locale, path: null}
    }
}
