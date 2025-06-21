// $$ cd .. && npm run test

import { parse } from "svelte/compiler"
import type { AST } from 'svelte/compiler'
import type { Expression } from 'estree'

type CompiledNestedFragment = (string | number | CompiledNestedFragment)[]
export type CompiledFragment = string | number | CompiledNestedFragment

function walkCompileNodes(node: Expression | AST.Fragment | AST.Text | AST.Tag | AST.ElementLike | AST.Block | AST.Comment): CompiledNestedFragment {
    if (node.type === 'Text') {
        return [node.data]
    }
    if (node.type === 'Literal') {
        if (typeof node.value === 'number') {
            return [node.value]
        }
        return []
    }
    if (node.type === 'ExpressionTag') {
        return walkCompileNodes(node.expression)
    }
    if (node.type === 'Component') {
        return [[
            Number(node.name.slice(1)),
            ...walkCompileNodes(node.fragment),
        ]]
    }
    if (node.type === 'Fragment') {
        const parts = []
        for (const child of node.nodes) {
            parts.push(...walkCompileNodes(child))
        }
        return parts
    }
    console.error('Unexpected node type', node)
    return []
}

export default function compileTranslation(text: string, fallback: CompiledFragment): CompiledFragment {
    if (!text) {
        return fallback
    }
    if (!text.includes('<') && !text.includes('{')) {
        return text
    }
    // <0></0> to <X0></X0> to please svelte parser
    text = text.replace(/(<|(<\/))(\d+)/g, '$1X$3')
    try {
        const ast = parse(text, { modern: true })
        return walkCompileNodes(ast.fragment)
    } catch (err) {
        console.error(err)
        return fallback
    }
}
