import { dirname, relative, resolve } from 'node:path'
import { platform } from 'node:process'
import type { Adapter, GlobConf, LoaderPath, LoadGroupPatt } from '../adapters.js'
import type { CompiledElement } from '../compile.js'
import type { FS } from '../fs.js'
import type { URLManifest } from '../url.js'

export const dataFileName = 'data.js'
export const generatedDir = '.wuchale'
export const defaultLoadID = 0

export type ManifestEntryObj = {
    text: string | string[]
    context?: string | undefined
    isUrl?: boolean | undefined
}

export type ManifestEntry = string | string[] | ManifestEntryObj | null

export type FilesOptsCreatePass = {
    adapter: Adapter
    key: string
    fs: FS
    root: string
}

export type FilesOptsCreate = FilesOptsCreatePass & {
    ownerKey: string
    localesDirAbs: string
}

type FilesOpts = FilesOptsCreate & {
    loaderPath: LoaderPath
}

export const objKeyLocale = (locale: string) => (locale.includes('-') ? `'${locale}'` : locale)

export function normalizeSep(path: string) {
    if (platform !== 'win32') {
        return path
    }
    return path.replaceAll('\\', '/')
}

export function globConfToArgs(conf: GlobConf, localesDir: string, outDir?: string): [string[], string[]] {
    let patterns: string[] = []
    // ignore generated files
    const ignore = [`${localesDir}/**/*`]
    if (outDir) {
        ignore.push(outDir)
    }
    if (typeof conf === 'string') {
        patterns = [conf]
    } else if (Array.isArray(conf)) {
        patterns = conf
    } else {
        if (typeof conf.include === 'string') {
            patterns.push(conf.include)
        } else {
            patterns = conf.include
        }
        if (typeof conf.ignore === 'string') {
            ignore.push(conf.ignore)
        } else {
            ignore.push(...conf.ignore)
        }
    }
    return [patterns.map(normalizeSep), ignore]
}

export async function getLoaderPath(
    adapter: Adapter,
    key: string,
    localesDirAbs: string,
    root: string,
    fs: FS,
): Promise<LoaderPath> {
    const loaderPathHead = resolve(localesDirAbs, `${key}.loader`)
    const paths: LoaderPath[] = []
    for (const ext of adapter.loaderExts) {
        const pathClient = loaderPathHead + ext
        const same = { client: pathClient, server: pathClient }
        const diff = { client: pathClient, server: `${loaderPathHead}.server${ext}` }
        if (adapter.defaultLoaderPath === null) {
            paths.push(diff, same)
        } else if (typeof adapter.defaultLoaderPath === 'string') {
            // same file for both
            paths.push(same)
        } else {
            paths.push(diff)
        }
    }
    for (const path of paths) {
        let bothExist = true
        for (const side in path) {
            if (!(await fs.exists(path[side as keyof LoaderPath]))) {
                bothExist = false
                break
            }
        }
        if (!bothExist) {
            continue
        }
        return path
    }
    if (adapter.defaultLoaderPath === null) {
        const loaderForms = paths
            .map(p => {
                let f = `  ${relative(root, p.client)}`
                if (p.server !== p.client) {
                    f += ` (and ${relative(root, p.server)})`
                }
                return f
            })
            .join('\n')
        throw new Error(
            `Custom loader specified for adapter '${key}' but no loader file exists in one of the forms:\n${loaderForms}`,
        )
    }
    return paths[0]!
}

function proxyFileName(key: string, sync = false) {
    const namePart = `${key}.proxy`
    if (sync) {
        return `${namePart}.sync.js`
    }
    return `${namePart}.js`
}

export class Files {
    #opts: FilesOpts
    readonly loaderPath: LoaderPath
    #proxyPath: string
    #proxySyncPath: string
    #urlManifestFname: string
    #urlsFname: string

    private constructor(opts: FilesOpts) {
        this.#opts = opts
        this.loaderPath = opts.loaderPath
        this.#proxyPath = resolve(opts.localesDirAbs, generatedDir, proxyFileName(opts.key))
        this.#proxySyncPath = resolve(opts.localesDirAbs, generatedDir, proxyFileName(opts.key, true))
        this.#urlManifestFname = resolve(opts.localesDirAbs, generatedDir, `${opts.key}.urls.js`)
        this.#urlsFname = resolve(opts.localesDirAbs, `${opts.key}.url.js`)
    }

    getCompiledFilePath(loc: string, id: number | null) {
        const ownerKey = this.#opts.ownerKey
        return resolve(this.#opts.localesDirAbs, generatedDir, `${ownerKey}.${id ?? defaultLoadID}.${loc}.compiled.js`)
    }

    getImportPath(filename: string, importer?: string) {
        const relTo = importer ? resolve(this.#opts.root, importer) : filename
        filename = normalizeSep(relative(dirname(relTo), filename))
        if (!filename.startsWith('../') && !filename.startsWith('./')) {
            filename = `./${filename}`
        }
        return filename
    }

    // typed to work regardless of user's noUncheckedIndexedAccess setting in tsconfig
    genProxyContent(catalogs: string[], patterns: LoadGroupPatt[], locales: string[], syncImports?: string[]) {
        const baseType = 'import("wuchale/runtime").CatalogModule'
        const byLocale = catalogs.map((locCats, i) => `${objKeyLocale(locales[i]!)}: ${locCats}`).join(',')
        return `
            ${syncImports?.join('\n') ?? ''}
            /** @typedef {${syncImports ? baseType : `() => Promise<${baseType}>`}} CatalogMod */
            /** @type {{[locale: string]: CatalogMod[]}} */
            const catalogs = {${byLocale}}
            export const loadCatalog = (/** @type {number} */ loadID, /** @type {string} */ locale) => {
                return /** @type {CatalogMod} */ (/** @type {CatalogMod[]} */ (catalogs[locale])[loadID])${syncImports ? '' : '()'}
            }
            export const loadCount = ${patterns.length}
            export const patterns = ${JSON.stringify(patterns)}
        `
    }

    genProxy(locales: string[], patterns: LoadGroupPatt[]) {
        const imports: string[] = []
        for (const loc of locales) {
            const importsForLocale: string[] = []
            for (const [loadID] of patterns.entries()) {
                importsForLocale.push(`() => import('${this.getImportPath(this.getCompiledFilePath(loc, loadID!))}')`)
            }
            imports.push(`[${importsForLocale.join(',')}]`)
        }
        return this.genProxyContent(imports, patterns, locales)
    }

    genProxySync(locales: string[], patterns: LoadGroupPatt[]) {
        const imports: string[] = []
        const object: string[] = []
        for (const [i, loc] of locales.entries()) {
            const importedForLocale: string[] = []
            for (const [loadID] of patterns.entries()) {
                const locKey = `_w_c_${loadID}_${i}_`
                imports.push(
                    `import * as ${locKey} from '${this.getImportPath(this.getCompiledFilePath(loc, loadID))}'`,
                )
                importedForLocale.push(locKey)
            }
            object.push(`[${importedForLocale.join(',')}]`)
        }
        return this.genProxyContent(object, patterns, locales, imports)
    }

    writeProxies = async (locales: string[], groupPatterns: LoadGroupPatt[]) => {
        const allPatterns: LoadGroupPatt[] = [this.#opts.key, ...groupPatterns]
        await this.#opts.fs.write(this.#proxyPath, this.genProxy(locales, allPatterns))
        await this.#opts.fs.write(this.#proxySyncPath, this.genProxySync(locales, allPatterns))
    }

    static create = async (opts: FilesOptsCreate) => {
        const { adapter, key, localesDirAbs, root, fs } = opts
        const loaderPath = await getLoaderPath(adapter, key, localesDirAbs, root, fs)
        if (adapter.defaultLoaderPath != null) {
            // write loader files
            for (const side in loaderPath) {
                let loaderTemplate: string
                if (typeof adapter.defaultLoaderPath === 'string') {
                    loaderTemplate = adapter.defaultLoaderPath
                } else {
                    loaderTemplate = adapter.defaultLoaderPath[side as keyof LoaderPath]
                }
                const loaderContent = (await fs.read(loaderTemplate))!
                    .toString()
                    .replaceAll('${PROXY}', `./${generatedDir}/${proxyFileName(key)}`)
                    .replaceAll('${PROXY_SYNC}', `./${generatedDir}/${proxyFileName(key, true)}`)
                    .replaceAll('${DATA}', `./${dataFileName}`)
                    .replaceAll('${KEY}', key)
                await fs.write(loaderPath[side as keyof LoaderPath], loaderContent)
            }
        }
        return new Files({ ...opts, loaderPath })
    }

    writeUrlFiles = async (manifest: URLManifest, fallbackLocale: string) => {
        if (manifest.length === 0) {
            if (await this.#opts.fs.exists(this.#urlManifestFname)) {
                await this.#opts.fs.unlink(this.#urlManifestFname)
            }
            if (await this.#opts.fs.exists(this.#urlsFname)) {
                await this.#opts.fs.unlink(this.#urlsFname)
            }
            return
        }
        const urlManifestData = [
            `/** @type {import('wuchale/url').URLManifest} */`,
            `export default ${JSON.stringify(manifest)}`,
        ].join('\n')
        await this.#opts.fs.write(this.#urlManifestFname, urlManifestData)
        const urlFileContent = [
            'import {URLMatcher, deLocalizeDefault} from "wuchale/url"',
            `import {locales} from "./${dataFileName}"`,
            `import manifest from "${this.getImportPath(this.#urlManifestFname, this.#urlsFname)}"`,
            `export const getLocale = (/** @type {URL} */ url) => deLocalizeDefault(url.pathname, locales)[1] ?? '${fallbackLocale}'`,
            `export const matchUrl = URLMatcher(manifest, locales)`,
        ].join('\n')
        await this.#opts.fs.write(this.#urlsFname, urlFileContent)
    }

    getManifestFilePath(id: number | null): string {
        const ownerKey = this.#opts.ownerKey
        return resolve(this.#opts.localesDirAbs, generatedDir, `${ownerKey}.${id ?? defaultLoadID}.manifest.js`)
    }

    writeManifest = async (keys: ManifestEntry[], id: number | null) => {
        const content =
            `/** @type {(string | string[] | {text: string | string[], context?: string, isUrl?: boolean})[]} */\n` +
            `export const keys = ${JSON.stringify(keys)}`
        await this.#opts.fs.write(this.getManifestFilePath(id), content)
    }

    writeCatalogModule = async (
        compiledData: CompiledElement[],
        pluralRule: string | null,
        locale: string,
        hmrVersion: number | null,
        loadID: number | null,
    ) => {
        const compiledItems = JSON.stringify(compiledData)
        let module = `/** @type import('wuchale').CompiledElement[] */\nexport let c = ${compiledItems}`
        if (pluralRule) {
            module = `${module}\nexport let p = (/** @type number */ n) => ${pluralRule}`
        }
        if (hmrVersion != null) {
            module = `
                ${module}
                // only during dev, for HMR
                let latestVersion = ${hmrVersion}
                // @ts-ignore
                export function update({ version, data }) {
                    if (latestVersion >= version) {
                        return
                    }
                    for (const [ index, item ] of data['${locale}'] ?? []) {
                        c[index] = item
                    }
                    latestVersion = version
                }
            `
        }
        await this.#opts.fs.write(this.getCompiledFilePath(locale, loadID), module)
    }

    writeTransformed = async (filename: string, content: string) => {
        if (!this.#opts.adapter.outDir) {
            return
        }
        const fname = resolve(`${this.#opts.adapter.outDir}/${filename}`)
        await this.#opts.fs.mkdir(dirname(fname))
        await this.#opts.fs.write(fname, content)
    }

    getImportLoaderPath(forServer: boolean, relativeTo: string) {
        return this.getImportPath(forServer ? this.#opts.loaderPath.server : this.#opts.loaderPath.client, relativeTo)
    }
}
