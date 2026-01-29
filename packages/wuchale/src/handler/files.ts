import { mkdir, readFile, statfs, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { platform } from 'node:process'
import type { Adapter, GlobConf, LoaderPath } from '../adapters.js'
import type { CompiledElement } from '../compile.js'
import { catalogVarName } from '../runtime.js'
import { type URLManifest } from '../url.js'

const dataFileName = 'data.js'
const generatedDir = '.wuchale'

export const objKeyLocale = (locale: string) => (locale.includes('-') ? `'${locale}'` : locale)

export function normalizeSep(path: string) {
    if (platform !== 'win32') {
        return path
    }
    return path.replaceAll('\\', '/')
}

export function globConfToArgs(conf: GlobConf, localesDir: string, outDir?: string): [string[], { ignore: string[] }] {
    let patterns: string[] = []
    // ignore generated files
    const options = { ignore: [localesDir] }
    if (outDir) {
        options.ignore.push(outDir)
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
            options.ignore.push(conf.ignore)
        } else {
            options.ignore.push(...conf.ignore)
        }
    }
    return [patterns.map(normalizeSep), options]
}

export class Files {
    key: string
    ownerKey: string
    #adapter: Adapter

    // paths
    loaderPath: LoaderPath
    proxyPath: string
    proxySyncPath: string
    #urlManifestFname: string
    #urlsFname: string
    #generatedDir: string

    constructor(adapter: Adapter, key: string, ownerKey: string) {
        this.key = key
        this.ownerKey = ownerKey
        this.#adapter = adapter
        this.#generatedDir = `${adapter.localesDir}/${generatedDir}`
    }

    getLoaderPaths(): LoaderPath[] {
        const loaderPathHead = join(this.#adapter.localesDir, `${this.key}.loader`)
        const paths: LoaderPath[] = []
        for (const ext of this.#adapter.loaderExts) {
            const pathClient = loaderPathHead + ext
            const same = { client: pathClient, server: pathClient }
            const diff = { client: pathClient, server: loaderPathHead + '.server' + ext }
            if (this.#adapter.defaultLoaderPath == null) {
                paths.push(diff, same)
            } else if (typeof this.#adapter.defaultLoaderPath === 'string') {
                // same file for both
                paths.push(same)
            } else {
                paths.push(diff)
            }
        }
        return paths
    }

    async getLoaderPath(): Promise<LoaderPath> {
        const paths = this.getLoaderPaths()
        for (const path of paths) {
            let bothExist = true
            for (const side in path) {
                try {
                    await statfs(path[side])
                } catch (err: any) {
                    if (err.code !== 'ENOENT') {
                        throw err
                    }
                    bothExist = false
                    break
                }
            }
            if (!bothExist) {
                continue
            }
            return path
        }
        return paths[0]
    }

    #proxyFileName(sync = false) {
        const namePart = `${this.key}.proxy`
        if (sync) {
            return `${namePart}.sync.js`
        }
        return `${namePart}.js`
    }

    async #initPaths() {
        this.loaderPath = await this.getLoaderPath()
        this.proxyPath = join(this.#generatedDir, this.#proxyFileName())
        this.proxySyncPath = join(this.#generatedDir, this.#proxyFileName(true))
        this.#urlManifestFname = join(this.#generatedDir, `${this.key}.urls.js`)
        this.#urlsFname = join(this.#adapter.localesDir, `${this.key}.url.js`)
    }

    getCompiledFilePath(loc: string, id: string | null) {
        const ownerKey = this.ownerKey
        return join(this.#generatedDir, `${ownerKey}.${id ?? ownerKey}.${loc}.compiled.js`)
    }

    getImportPath(filename: string, importer?: string) {
        filename = normalizeSep(relative(dirname(importer ?? filename), filename))
        if (!filename.startsWith('.')) {
            filename = `./${filename}`
        }
        return filename
    }

    // typed to work regardless of user's noUncheckedIndexedAccess setting in tsconfig
    genProxyContent(catalogs: string[], loadIDs: string[], syncImports?: string[]) {
        const baseType = 'import("wuchale/runtime").CatalogModule'
        return `
            ${syncImports?.join('\n') ?? ''}
            /** @typedef {${syncImports ? baseType : `() => Promise<${baseType}>`}} CatalogMod */
            /** @typedef {{[locale: string]: CatalogMod}} KeyCatalogs */
            /** @type {{[loadID: string]: KeyCatalogs}} */
            const catalogs = {${catalogs.join(',')}}
            export const loadCatalog = (/** @type {string} */ loadID, /** @type {string} */ locale) => {
                return /** @type {CatalogMod} */ (/** @type {KeyCatalogs} */ (catalogs[loadID])[locale])${syncImports ? '' : '()'}
            }
            export const loadIDs = ['${loadIDs.join("', '")}']
        `
    }

    genProxy(locales: string[], loadIDs: string[], loadIDsImport: string[]) {
        const imports: string[] = []
        for (const [i, id] of loadIDs.entries()) {
            const importsByLocale: string[] = []
            for (const loc of locales) {
                importsByLocale.push(
                    `${objKeyLocale(loc)}: () => import('${this.getImportPath(this.getCompiledFilePath(loc, loadIDsImport[i]))}')`,
                )
            }
            imports.push(`${id}: {${importsByLocale.join(',')}}`)
        }
        return this.genProxyContent(imports, loadIDs)
    }

    genProxySync(locales: string[], loadIDs: string[], loadIDsImport: string[]) {
        const imports: string[] = []
        const object: string[] = []
        for (const [il, id] of loadIDs.entries()) {
            const importedByLocale: string[] = []
            for (const [i, loc] of locales.entries()) {
                const locKey = `_w_c_${id}_${i}_`
                imports.push(
                    `import * as ${locKey} from '${this.getImportPath(this.getCompiledFilePath(loc, loadIDsImport[il]))}'`,
                )
                importedByLocale.push(`${objKeyLocale(loc)}: ${locKey}`)
            }
            object.push(`${id}: {${importedByLocale.join(',')}}`)
        }
        return this.genProxyContent(object, loadIDs, imports)
    }

    writeProxies = async (locales: string[], loadIDs: string[], loadIDsImport: string[]) => {
        await writeFile(this.proxyPath, this.genProxy(locales, loadIDs, loadIDsImport))
        await writeFile(this.proxySyncPath, this.genProxySync(locales, loadIDs, loadIDsImport))
    }

    init = async (locales: string[], sourceLocale: string) => {
        await this.#initPaths()
        await mkdir(this.#generatedDir, { recursive: true })
        // data file
        await writeFile(
            join(this.#adapter.localesDir, dataFileName),
            [`export const sourceLocale = '${sourceLocale}'`, `export const locales = ['${locales.join("','")}']`].join(
                '\n',
            ),
        )
        if (this.#adapter.defaultLoaderPath == null) {
            // using custom loaders
            return
        }
        for (const side in this.loaderPath) {
            let loaderTemplate: string
            if (typeof this.#adapter.defaultLoaderPath === 'string') {
                loaderTemplate = this.#adapter.defaultLoaderPath
            } else {
                loaderTemplate = this.#adapter.defaultLoaderPath[side]
            }
            const loaderContent = (await readFile(loaderTemplate))
                .toString()
                .replace('${PROXY}', `./${generatedDir}/${this.#proxyFileName()}`)
                .replace('${PROXY_SYNC}', `./${generatedDir}/${this.#proxyFileName(true)}`)
                .replace('${DATA}', `./${dataFileName}`)
                .replace('${KEY}', this.key)
            await writeFile(this.loaderPath[side], loaderContent)
        }
    }

    writeUrlFiles = async (manifest: URLManifest, fallbackLocale: string) => {
        const urlManifestData = [
            `/** @type {import('wuchale/url').URLManifest} */`,
            `export default ${JSON.stringify(manifest)}`,
        ].join('\n')
        await writeFile(this.#urlManifestFname, urlManifestData)
        const urlFileContent = [
            'import {URLMatcher, getLocaleDefault} from "wuchale/url"',
            `import {locales} from "./${dataFileName}"`,
            `import manifest from "./${relative(dirname(this.#urlsFname), this.#urlManifestFname)}"`,
            `export const getLocale = (/** @type {URL} */ url) => getLocaleDefault(url, locales) ?? '${fallbackLocale}'`,
            `export const matchUrl = URLMatcher(manifest, locales)`,
        ].join('\n')
        await writeFile(this.#urlsFname, urlFileContent)
    }

    writeCatalogModule = async (
        compiledData: CompiledElement[],
        pluralRule: string | null,
        locale: string,
        hmrVersion: number | null,
        loadID: string | null,
    ) => {
        const compiledItems = JSON.stringify(compiledData)
        let module = `/** @type import('wuchale').CompiledElement[] */\nexport let ${catalogVarName} = ${compiledItems}`
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
                        ${catalogVarName}[index] = item
                    }
                    latestVersion = version
                }
            `
        }
        await writeFile(this.getCompiledFilePath(locale, loadID), module)
    }

    writeTransformed = async (filename: string, content: string) => {
        if (!this.#adapter.outDir) {
            return
        }
        const fname = resolve(this.#adapter.outDir + '/' + filename)
        await mkdir(dirname(fname), { recursive: true })
        await writeFile(fname, content)
    }

    getImportLoaderPath(forServer: boolean, relativeTo: string) {
        return this.getImportPath(forServer ? this.loaderPath.server : this.loaderPath.client, relativeTo)
    }
}
