// $$ cd .. && npm run test
// $$ node %f

import { parse } from "svelte/compiler"

function walkCompileNodes(ast) {
    const parts = []
    if (ast.type === 'Text') {
        parts.push(ast.data)
    } else if (ast.type === 'InlineComponent') {
        const nodeIndex = Number(ast.name.slice(1))
        const subParts = [nodeIndex]
        for (const child of ast.children) {
            subParts.push(...walkCompileNodes(child))
        }
        parts.push(subParts)
    } else if (ast.type === 'MustacheTag') {
        parts.push(ast.expression.value)
    } else if (ast.type === 'Fragment') {
        for (const child of ast.children) {
            parts.push(...walkCompileNodes(child))
        }
    } else {
        console.log(ast)
    }
    return parts
}

export default function compileTranslation(text) {
    if (!text || !text.includes('<') && !text.includes('{')) {
        return text
    }
    // <0></0> to <X0></X0> to please svelte parser
    const ast = parse(text.replace(/(<|(<\/))(\d+)/g, '$1X$3')).html
    return walkCompileNodes(ast)
}
