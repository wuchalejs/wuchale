/**
 * This is for use when testing, importing relative paths as .js
 * Use it like:
 *  node --import ./resolve.ts --test
 */

import { registerHooks } from 'node:module'
import { dirname, resolve as pathResolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const thisDir = dirname(fileURLToPath(import.meta.url))

function srcToDist(path: string): string {
    const marker = `${sep}src${sep}`
    const idx = path.lastIndexOf(marker)
    if (idx === -1) return path
    return `${path.slice(0, idx)}${sep}dist${sep}${path.slice(idx + marker.length)}`
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
                if (
                    (absoluteTarget.includes('/src/') || absoluteTarget.includes('\\src\\')) &&
                    absoluteTarget.endsWith('.js')
                ) {
                    const redirectedPath = srcToDist(absoluteTarget)
                    const newUrl = pathToFileURL(redirectedPath).href
                    return nextResolve(newUrl)
                }
            }
        }
        return nextResolve(specifier, context)
    },
})
