/**
 * This is for use when testing, importing relative paths as .js
 * Use it like:
 *  node --import ./resolve.ts --test
 */

import { registerHooks } from 'node:module'
import { dirname, resolve as pathResolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const thisDir = dirname(fileURLToPath(import.meta.url))

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
                if (absoluteTarget.includes('/src/') || absoluteTarget.includes('\\src\\')) {
                    const redirectedPath = absoluteTarget.replace('/src/', '/dist/').replace('\\src\\', '\\dist\\')
                    const newUrl = pathToFileURL(redirectedPath).href
                    return nextResolve(newUrl)
                }
            }
        }
        return nextResolve(specifier, context)
    },
})
