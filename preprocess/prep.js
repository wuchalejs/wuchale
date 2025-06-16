// $$ cd .. && npm run test

import { parse } from "svelte/compiler"
import MagicString from "magic-string"

const snipPrefix = 'wuchaleSnippet'
const rtComponent = 'WuchaleTrans'
const rtFunc = 'wuchaleTrans'

class NestText extends String {
    /**
     * @param {string} txt
     * @param {string} scope
     */
    constructor(txt, scope) {
        super(txt)
        this.scope = scope
    }
}

export class IndexTracker {
    /**
     * @param {object} sourceTranslations
     */
    constructor(sourceTranslations) {
        this.indices = {}
        this.nextIndex = 0
        for (const txt of Object.keys(sourceTranslations)) {
            // guaranteed order for strings since ES2015
            this.indices[txt] = this.nextIndex
            this.nextIndex++
        }
    }

    get = (/** @type {string} */ txt) => {
        if (txt in this.indices) {
            return this.indices[txt]
        }
        const index = this.nextIndex
        this.indices[txt] = index
        this.nextIndex++
        return index
    }
}

export default class Preprocess {
    /**
     * @param {IndexTracker} index
     * @param {(text: string, scope?: string) => Array<*> & {0: boolean;1: string;}} heuristic
     * @param {string} importFrom
     */
    constructor(index, heuristic, importFrom) {
        this.index = index
        this.importFrom = importFrom
        this.heuristic = heuristic
        this.content = ''
        /** @type {MagicString} */
        this.mstr = null
    }

    /**
     * @param {{ start: number; end: number; }} node
     * @param {string} text
     * @param {string} scope
     * @returns {Array<*> & {0: boolean, 1: NestText}}
     */
    modifyCheck = (node, text, scope) => {
        text = text.replace(/\s+/g, ' ').trim()
        let [pass, modify] = this.heuristic(text, scope)
        modify = modify.trim()
        if (!pass && text !== modify) {
            this.mstr.update(node.start, node.end, modify)
        }
        return [pass, new NestText(modify, scope)]
    }

    visitLiteral = node => {
        if (typeof node.value !== 'string') {
            return []
        }
        const [pass, txt] = this.modifyCheck(node, node.value, 'script')
        if (!pass) {
            return []
        }
        this.mstr.update(node.start, node.end, `${rtFunc}(${this.index.get(txt.toString())})`)
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
        const [pass, txt] = this.modifyCheck(quasi0, quasi0.value.cooked, 'script')
        if (!pass) {
            return txts
        }
        let nTxt = txt.toString()
        for (const [i, expr] of node.expressions.entries()) {
            txts.push(...this.visit(expr))
            const quasi = node.quasis[i + 1]
            nTxt += `{${i}}${quasi.value.cooked}`
            this.mstr.remove(quasi.start - 1, quasi.end)
            if (i + 1 === node.expressions.length) {
                continue
            }
            this.mstr.update(quasi.end, quasi.end + 2, ', ')
        }
        let repl = `${rtFunc}(${this.index.get(txt.toString())}`
        if (node.expressions.length) {
            repl += ', '
        }
        this.mstr.update(quasi0.start - 1, quasi0.end + 2, repl)
        this.mstr.update(node.end - 1, node.end, ')')
        txts.push(new NestText(nTxt, 'script'))
        return txts
    }


    visitMustacheTag = node => this.visit(node.expression)

    visitComment = node => []

    checkHasCompoundText = node => {
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
        if (node.children[0].type === 'Text') {
            const [pass] = this.modifyCheck(node.children[0], node.children[0].data, 'markup')
            if (!pass) {
                return txts
            }
        }
        let txt = ''
        let iArg = 0
        let iTag = 0
        const hasCompoundText = this.checkHasCompoundText(node)
        const lastChildEnd = node.children.slice(-1)[0].end
        for (const child of node.children) {
            if (child.type === 'Text') {
                const [pass, modify] = this.modifyCheck(child, child.data, 'markup')
                if (!pass) {
                    continue
                }
                txt += ' ' + modify
                if (node.inCompoundText && node.children.length === 1) {
                    this.mstr.update(child.start, child.end, `{ctx[1]}`)
                } else {
                    this.mstr.remove(child.start, child.end)
                }
                continue
            }
            if (!node.inCompoundText && !hasCompoundText) {
                txts.push(...this.visit(child))
                continue
            }
            if (child.type === 'MustacheTag') {
                txts.push(...this.visitMustacheTag(child))
                txt += ` {${iArg}}`
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
            // elements and components
            child.inCompoundText = true
            let chTxt = ''
            for (const txt of this.visit(child)) {
                if (txt.scope === 'markup') {
                    chTxt += txt.toString()
                } else {
                    txts.push(txt)
                }
            }
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
            if (!txt.endsWith(' ')) {
                txt += ' '
            }
            txt += chTxt
        }
        txt = txt.trim()
        if (!txt) {
            return txts
        }
        const nTxt = new NestText(txt, 'markup')
        txts.push(nTxt)
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
                begin += `id={${this.index.get(txt)}}`
            }
            let end = ' />\n'
            if (iArg > 0) {
                begin += ' args={['
                end = ']}' + end
            }
            this.mstr.appendLeft(lastChildEnd, begin)
            this.mstr.appendRight(lastChildEnd, end)
        } else if (!node.inCompoundText) {
            this.mstr.appendLeft(lastChildEnd, `{${rtFunc}(${this.index.get(txt)}, `)
            this.mstr.appendRight(lastChildEnd, ')}')
        }
        return txts
    }

    visitInlineComponent = this.visitElement

    visitAttribute = node => {
        // no idea why value is an array, take the first one to decide the type of enclosure ("" vs {})
        if (node.type === 'Spread') {
            return this.visit(node.expression)
        }
        let value = node.value
        if (node.value && node.value !== true) {
            value = node.value[0]
        }
        if (value.type !== 'Text') {
            return this.visit(value)
        }
        const [pass, txt] = this.modifyCheck(value, value.data, 'attribute')
        if (!pass) {
            return []
        }
        const txts = [txt]
        this.mstr.update(value.start, value.end, `{${rtFunc}(${this.index.get(txt.toString())})}`)
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
