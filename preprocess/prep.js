// $$ cd .. && npm run test

import { parse } from "svelte/compiler"
import MagicString from "magic-string"

const snipPrefix = 'wuchaleSnippet'
const rtComponent = 'WuchaleTrans'
const rtFunc = 'wuchaleTrans'

export default class Preprocess {
    constructor(indices = {}, nextIndex = 0, importFrom = '../runtime.svelte') {
        this.indices = indices
        this.nextIndex = nextIndex
        this.importFrom = importFrom
        this.content = ''
        /** @type {MagicString} */
        this.mstr = null
    }

    getIndex = (/** @type {string} */ txt) => {
        if (txt in this.indices) {
            return this.indices[txt]
        }
        const index = this.nextIndex
        this.indices[txt] = index
        this.nextIndex += 1
        return index
    }

    visitLiteral = node => {
        if (typeof node.value !== 'string' || !node.value.startsWith('+')) {
            return []
        }
        const txt = node.value.slice(1)
        this.mstr.update(node.start, node.end, `${rtFunc}(${this.getIndex(txt)})`)
        return [txt]
    }

    visitArrayExpression = node => {
        const txts = []
        for (const elm of node.elements) {
            txts.push(...this.visit(elm))
        }
        return txts
    }

    visitObjectExpression = node => {
        const txts = []
        for (const prop of node.properties) {
            txts.push(...this.visit(prop.key))
            txts.push(...this.visit(prop.value))
        }
        return txts
    }

    visitMemberExpression = node => {
        return [
            ...this.visit(node.object),
            ...this.visit(node.property),
        ]
    }

    visitCallExpression = node => {
        const txts = [...this.visit(node.callee)]
        for (const arg of node.arguments) {
            txts.push(...this.visit(arg))
        }
        return txts
    }

    visitVariableDeclaration = node => {
        const txts = []
        for (const dec of node.declarations) {
            if (!dec.init) {
                continue
            }
            const decVisit = this.visit(dec.init)
            if (!decVisit.length) {
                continue
            }
            txts.push(...decVisit)
            if (dec.init.type === 'CallExpression' && dec.init.callee.type === 'Identifier' && dec.init.callee.name.startsWith('$')) {
                continue
            }
            this.mstr.prependLeft(dec.init.start, '$derived(')
            this.mstr.appendRight(dec.init.end, ')')
        }
        return txts
    }

    visitTemplateLiteral = node => {
        const txts = []
        const quasi0 = node.quasis[0]
        let txt = quasi0.value.cooked
        for (const [i, expr] of node.expressions.entries()) {
            txts.push(...this.visit(expr))
            const quasi = node.quasis[i + 1]
            txt += `{${i}}${quasi.value.cooked}`
            this.mstr.remove(quasi.start - 1, quasi.end)
            if (i + 1 === node.expressions.length) {
                continue
            }
            this.mstr.update(quasi.end, quasi.end + 2, ', ')
        }
        if (!quasi0.value.cooked.startsWith('+')) {
            return txts
        }
        let repl = `${rtFunc}(${this.getIndex(txt)}`
        if (node.expressions.length) {
            repl += ', '
        }
        this.mstr.update(quasi0.start - 1, quasi0.end + 2, repl)
        this.mstr.update(node.end - 1, node.end, ')')
        txts.push(txt)
        return txts
    }


    visitText = node => {
        let txt = node.data.replace(/\s+/g, ' ')
        let ttxt = txt.trim()
        if (!ttxt || ttxt.startsWith('-')) {
            return []
        }
        this.mstr.update(node.start, node.end, `{${rtFunc}(${this.getIndex(txt)})}`)
        return [txt]
    }

    visitMustacheTag = node => this.visit(node.expression)

    visitComment = node => []

    checkHasCompoundText = node => {
        if (node.inCompoundText) {
            return true
        }
        let text = false
        let nonText = false
        for (const child of node.children ?? []) {
            if (child.type === 'Text') {
                if (child.data.trim()) {
                    text = true
                }
            } else if (child.type !== 'Comment') {
                nonText = true
            }
        }
        return text && nonText // mixed content
    }

    visitElement = node => {
        const txts = []
        for (const attrib of node.attributes) {
            txts.push(...this.visitAttribute(attrib))
        }
        if (node.children.length === 0) {
            return txts
        }
        let txt = ''
        let iArg = 0
        let iTag = 0
        const hasCompoundText = this.checkHasCompoundText(node)
        const lastChildEnd = node.children.slice(-1)[0].end
        for (const child of node.children) {
            if (!hasCompoundText) {
                txts.push(...this.visit(child))
                continue
            }
            if (child.type === 'Text') {
                if (!child.data.trim()) {
                    continue
                }
                txt += child.data
                if (node.inCompoundText && node.children.length === 1) {
                    this.mstr.update(child.start, child.end, `{ctx[1]}`)
                } else {
                    this.mstr.remove(child.start, child.end)
                }
                continue
            }
            if (child.type === 'MustacheTag') {
                txts.push(...this.visitMustacheTag(child))
                txt += `{${iArg}}`
                this.mstr.move(child.start + 1, child.end - 1, lastChildEnd)
                if (iArg > 0) {
                    this.mstr.update(child.start, child.start + 1, ', ')
                } else {
                    this.mstr.remove(child.start, child.start + 1)
                }
                this.mstr.remove(child.end - 1, child.end)
                iArg++
                continue
            }
            child.inCompoundText = true
            // elements and components
            let chTxt = this.visit(child).join()
            if (child.type === 'Element') {
                chTxt = `<${iTag}>${chTxt}</${iTag}>`
            } else {
                // InlineComponent
                chTxt = `<${iTag}/>`
            }
            const snippetName = `${snipPrefix}${iTag}`
            const snippetBegin = `\n{#snippet ${snippetName}(ctx)}\n`
            const snippetEnd = '\n{/snippet}'
            this.mstr.appendRight(child.start, snippetBegin)
            this.mstr.prependLeft(child.end, snippetEnd)
            iTag++
            txt += chTxt
        }
        if (!txt.trim()) {
            return txts
        }
        txts.push(txt)
        if (iTag > 0) {
            const snippets = []
            // reference all new snippets added
            for (let i = 0; i < iTag; i++) {
                snippets.push(`${snipPrefix}${i}`)
            }
            let begin = `\n<${rtComponent} tags={[${snippets.join(', ')}]} `
            if (node.inCompoundText) {
                begin += `ctx={ctx}`
            } else {
                begin += `id={${this.getIndex(txt)}}`
            }
            let end = ' />\n'
            if (iArg > 0) {
                begin += ' args={['
                end = ']}' + end
            }
            this.mstr.appendLeft(lastChildEnd, begin)
            this.mstr.appendRight(lastChildEnd, end)
        } else if (!node.inCompoundText) {
            this.mstr.appendLeft(lastChildEnd, `{${rtFunc}(${this.getIndex(txt)}, `)
            this.mstr.appendRight(lastChildEnd, ')}')
        }
        return txts
    }

    visitInlineComponent = this.visitElement

    visitAttribute = node => {
        // no idea why value is an array, take the first one to decide the type of enclosure ("" vs {})
        let value = node.value
        if (node.value && node.value !== true) {
            value = node.value[0]
        }
        if (value.type !== 'Text') {
            return this.visit(value)
        }
        if (!value.data.trim().startsWith('+')) {
            return []
        }
        const txts = this.visit(value)
        if (!txts.length) {
            return txts
        }
        let {start, end} = value
        if (!`'"`.includes(this.content[start - 1])) {
            return txts
        }
        this.mstr.remove(start - 1, start)
        this.mstr.remove(end, end + 1)
        return txts
    }

    visitSnippetBlock = node => {
        const txt = []
        for (const child of node.children) {
            txt.push(...this.visit(child))
        }
        return txt
    }

    visit = node => {
        const methodName = `visit${node.type}`
        if (methodName in this) {
            return this[methodName](node)
        }
        // console.log(node)
        return []
    }

    process = ({ content, filename }) => {
        this.content = content
        this.mstr = new MagicString(content)
        const ast = parse(content, {filename})
        const txts = []
        for (const node of ast.instance?.content?.body ?? []) {
            txts.push(...this.visit(node))
        }
        for (const node of ast.html.children) {
            txts.push(...this.visit(node))
        }
        const importStmt = `import ${rtComponent}, {${rtFunc}} from "${this.importFrom}"`
        if (ast.instance) {
            this.mstr.appendRight(ast.instance.content.start, importStmt)
        } else {
            this.mstr.prepend(`<script>${importStmt}</script>\n`)
        }
        return txts
    }
}
