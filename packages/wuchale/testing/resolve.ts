/**
 * This is for use when testing, importing relative paths as .js
 * Use it like:
 *  node --import ./resolve.ts --test
 */

import { registerHooks } from 'node:module'
import { dirname, resolve as pathResolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const thisDir = dirname(fileURLToPath(import.meta.url))
const findAfter = `${sep}wuchale${sep}packages${sep}`
const distPatt = `${sep}dist${sep}`
const srcPatt = `${sep}src${sep}`

registerHooks({
    resolve: (specifier, context, nextResolve) => {
        const { parentURL } = context
        if (parentURL) {
            const parentPath = fileURLToPath(parentURL ?? '')
            const parentDir = dirname(parentPath)
            const findAfterIs = specifier.indexOf(findAfter) + findAfter.length
            const findAfterIu = parentURL.indexOf(findAfter) + findAfter.length
            if (
                !specifier.includes(distPatt, findAfterIs) &&
                (parentURL.includes('.test.', findAfterIu) || parentDir === thisDir) &&
                specifier.startsWith('.')
            ) {
                const absoluteTarget = pathResolve(parentDir, specifier)
                const findAfterIt = absoluteTarget.indexOf(findAfter) + findAfter.length
                if (absoluteTarget.includes(srcPatt, findAfterIt) && absoluteTarget.endsWith('.js')) {
                    const redirectedPath =
                        absoluteTarget.slice(0, findAfterIt) +
                        absoluteTarget.slice(findAfterIt).replace(srcPatt, distPatt)
                    const newUrl = pathToFileURL(redirectedPath).href
                    return nextResolve(newUrl)
                }
            }
        }
        return nextResolve(specifier, context)
    },
})
