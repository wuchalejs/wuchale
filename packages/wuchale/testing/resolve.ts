/**
 * This is for use when testing, importing relative paths as .js
 * Use it like:
 *  node --import ./resolve.ts --test
 */

import { registerHooks } from 'node:module'
import { basename, dirname, resolve as pathResolve, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const thisDir = dirname(fileURLToPath(import.meta.url))

function findPackageRoot(parentDir: string): string | null {
    if (parentDir === thisDir) return dirname(parentDir)
    for (let dir = parentDir; ; ) {
        if (basename(dir) === 'src') return dirname(dir)
        const parent = dirname(dir)
        if (parent === dir) return null
        dir = parent
    }
}

function srcToDist(path: string, packageRoot: string): string {
    const rel = relative(packageRoot, path)
    const marker = `src${sep}`
    if (!rel.startsWith(marker)) return path
    return pathResolve(packageRoot, `dist${sep}${rel.slice(marker.length)}`)
}

registerHooks({
    resolve: (specifier, context, nextResolve) => {
        const { parentURL } = context
        if (parentURL) {
            const parentPath = fileURLToPath(parentURL ?? '')
            const parentDir = dirname(parentPath)
            if (
                !(specifier.includes('/dist/') || specifier.includes('\\dist\\')) &&
                (parentURL.includes('.test.') || parentDir === thisDir) &&
                specifier.startsWith('.')
            ) {
                const absoluteTarget = pathResolve(parentDir, specifier)
                const packageRoot = findPackageRoot(parentDir)
                if (
                    packageRoot &&
                    (absoluteTarget.includes('/src/') || absoluteTarget.includes('\\src\\')) &&
                    absoluteTarget.endsWith('.js')
                ) {
                    const redirectedPath = srcToDist(absoluteTarget, packageRoot)
                    const newUrl = pathToFileURL(redirectedPath).href
                    return nextResolve(newUrl)
                }
            }
        }
        return nextResolve(specifier, context)
    },
})
