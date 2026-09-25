import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tsPlugin } from '@sveltejs/acorn-typescript'
import type { Identifier, ImportDeclaration, Node, Property, VariableDeclaration } from 'acorn'
import { Parser } from 'acorn'
import MagicString from 'magic-string'
import type { DetectProjectResult } from './types.js'

const parser = Parser.extend(tsPlugin())

type ConfigAnalysis = {
    hasImport: boolean
    hasPlugin: boolean
    pluginPosition: number | null
}

const analysis: ConfigAnalysis = {
    hasImport: false,
    hasPlugin: false,
    pluginPosition: null,
}

export function writeViteConfig(project: DetectProjectResult) {
    if (!project.hasViteConfig) {
        return
    }

    analysis.hasImport = false
    analysis.hasPlugin = false
    analysis.pluginPosition = null

    const viteFileExtension = getViteConfigExtension()
    if (!viteFileExtension) return

    const content = readFileSync(`./vite.config.${viteFileExtension}`, 'utf8')
    const ast = parser.parse(content, {
        sourceType: 'module',
        ecmaVersion: 'latest',
    })

    const s = new MagicString(content)

    for (const node of ast.body) {
        if (analysis.hasImport && analysis.hasPlugin) break
        walkNodes(node)
    }

    if (!analysis.hasImport) {
        s.prepend("import { wuchale } from 'wuchale/vite'\n")
    }

    if (!analysis.hasPlugin && analysis.pluginPosition !== null) {
        s.appendLeft(analysis.pluginPosition, 'wuchale(), ')
    }

    const result = s.toString()

    if (result !== content) {
        writeFileSync(`./vite.config.${viteFileExtension}`, result)
    }
}

function getViteConfigExtension(): string | undefined {
    if (existsSync('./vite.config.ts')) return 'ts'
    if (existsSync('./vite.config.js')) return 'js'

    return undefined
}

function walkNodes(node: Node) {
    if (analysis.hasImport && analysis.hasPlugin) return

    if (node.type === 'VariableDeclaration') {
        const variable = node as VariableDeclaration
        for (const declaration of variable.declarations) {
            const identifier = declaration.id as Identifier
            if (identifier.name === 'plugins' && declaration.init?.type === 'ArrayExpression') {
                const elements = declaration.init.elements ?? []
                for (const element of elements) {
                    if (element?.type === 'CallExpression') {
                        const callee = element.callee as Identifier
                        if (callee.name === 'wuchale') {
                            analysis.hasPlugin = true
                            break
                        }
                    }
                }
                if (analysis.hasPlugin) break
                if (!analysis.hasPlugin) {
                    analysis.pluginPosition = declaration.init.start + 1
                }
            }
        }
    }

    if (node.type === 'Property') {
        const property = node as Property

        if (
            property.value.type === 'ArrayExpression' &&
            property.key.type === 'Identifier' &&
            property.key.name === 'plugins'
        ) {
            const arr = property.value
            for (const element of arr.elements) {
                if (
                    element?.type === 'CallExpression' &&
                    element.callee.type === 'Identifier' &&
                    element.callee.name === 'wuchale'
                ) {
                    analysis.hasPlugin = true
                    break
                }
            }
            if (!analysis.hasPlugin) {
                analysis.pluginPosition = arr.start + 1
            }
        }
    }

    if (node.type === 'ImportDeclaration') {
        const importNode = node as ImportDeclaration
        for (const spec of importNode.specifiers) {
            if (
                spec.type === 'ImportSpecifier' &&
                spec.imported.type === 'Identifier' &&
                importNode.source.value === 'wuchale/vite' &&
                spec.imported.name === 'wuchale'
            ) {
                analysis.hasImport = true
                break
            }
        }
    }

    for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
            for (const child of value) {
                if (isNode(child)) {
                    walkNodes(child)
                }
            }
        } else if (isNode(value)) {
            walkNodes(value)
        }
    }
}

function isNode(value: unknown): value is Node {
    return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
}
