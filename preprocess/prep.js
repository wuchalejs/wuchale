// $$ cd .. && npm run test

import MagicString from "magic-string"

const snipPrefix = 'wuchaleSnippet'
const rtComponent = 'WuchaleTrans'
const rtFunc = 'wuchaleTrans'

/**
 * @typedef {"script" | "markup" | "attribute"} TxtScope
 * @typedef {(text: string, scope: TxtScope) => boolean} HeuristicFunc
 */

/**
 * @type {HeuristicFunc}
 */
export function defaultHeuristic(text, scope = 'markup') {
    if (scope === 'markup') {
        return true
    }
    // script and attribute
    const range = 'AZ'
    const startCode = text.charCodeAt(0)
    return startCode >= range.charCodeAt(0) && startCode <= range.charCodeAt(1)
}

export class NestText extends String {
    /**
     * @param {string} txt
     * @param {TxtScope} scope
     * @param {string | null} [context]
     */
    constructor(txt, scope, context) {
        super(txt)
        this.scope = scope
        /** @type {string} */
        this.context = context ?? null
    }

    toKey = () => `${this.toString()}\n${this.context ?? ''}`.trim()

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
     * @param {HeuristicFunc} heuristic
     * @param {string} importFrom
     */
    constructor(index, heuristic = defaultHeuristic, importFrom = 'wuchale/runtime.svelte') {
        this.index = index
        this.importFrom = importFrom
        this.heuristic = heuristic
        this.content = ''
        /** @type {MagicString} */
        this.mstr = null
        /** @type {boolean | null} */
        this.forceInclude = null
        /** @type {string} */
        this.context = null
    }

    /**
     * @param {string} text
     * @param {TxtScope} scope
     * @returns {Array<*> & {0: boolean, 1: NestText}}
     */
    checkHeuristic = (text, scope) => {
        text = text.replace(/\s+/g, ' ').trim()
        if (text === '') {
            // nothing to ask
            return [false, null]
        }
        const extract = this.forceInclude || this.heuristic(text, scope)
        return [extract, new NestText(text, scope)]
    }

    // visitComment = () => []
    // visitIdentifier = () => []
    // visitImportDeclaration = () => []

    /**
     * @param {import('estree').Literal & {start: number, end: number}} node
     * @returns {NestText[]}
     */
    visitLiteral = node => {
        if (typeof node.value !== 'string') {
            return []
        }
        const { start, end } = node
        const [pass, txt] = this.checkHeuristic(node.value, 'script')
        if (!pass) {
            return []
        }
        txt.context = this.context
        this.mstr.update(start, end, `${rtFunc}(${this.index.get(txt.toKey())})`)
        return [txt]
    }

    /**
     * @param {import('estree').ArrayExpression} node
     * @returns {NestText[]}
     */
    visitArrayExpression = node => {
        const txts = []
        for (const elm of node.elements) {
            txts.push(...this.visit(elm))
        }
        return txts
    }

    /**
     * @param {import('estree').ObjectExpression} node
     * @returns {NestText[]}
     */
    visitObjectExpression = node => {
        const txts = []
        for (const prop of node.properties) {
            // @ts-ignore
            txts.push(...this.visit(prop.key))
            // @ts-ignore
            txts.push(...this.visit(prop.value))
        }
        return txts
    }

    /**
     * @param {import('estree').MemberExpression} node
     * @returns {NestText[]}
     */
    visitMemberExpression = node => {
        return [
            ...this.visit(node.object),
            ...this.visit(node.property),
        ]
    }

    /**
     * @param {import('estree').CallExpression} node
     * @returns {NestText[]}
     */
    visitCallExpression = node => {
        const txts = [...this.visit(node.callee)]
        for (const arg of node.arguments) {
            txts.push(...this.visit(arg))
        }
        return txts
    }

    /**
     * @param {import('estree').BinaryExpression} node
     * @returns {NestText[]}
     */
    visitBinaryExpression = node => {
        return [
            ...this.visit(node.left),
            ...this.visit(node.right),
        ]
    }

    /**
     * @param {import('estree').VariableDeclaration} node
     * @returns {NestText[]}
     */
    visitVariableDeclaration = node => {
        const txts = []
        for (const dec of node.declarations) {
            if (!dec.init) {
                continue
            }
            // visit only contents inside $derived
            if (dec.init.type !== 'CallExpression' || dec.init.callee.type !== 'Identifier' || dec.init.callee.name !== '$derived') {
                continue
            }
            const decVisit = this.visit(dec.init)
            if (!decVisit.length) {
                continue
            }
            txts.push(...decVisit)
        }
        return txts
    }

    /**
     * @param {import('estree').ExportDefaultDeclaration} node
     * @returns {NestText[]}
     */
    visitExportDefaultDeclaration = node => this.visit(node.declaration)

    /**
     * @param {import('estree').TemplateLiteral} node
     * @returns {NestText[]}
     */
    visitTemplateLiteral = node => {
        const txts = []
        const quasi0 = node.quasis[0]
        // @ts-ignore
        const {start: start0, end: end0} = quasi0
        const [pass, txt0] = this.checkHeuristic(quasi0.value.cooked, 'script')
        if (!pass) {
            return txts
        }
        let txt = txt0.toString()
        for (const [i, expr] of node.expressions.entries()) {
            txts.push(...this.visit(expr))
            const quasi = node.quasis[i + 1]
            txt += `{${i}}${quasi.value.cooked}`
            // @ts-ignore
            const {start, end} = quasi
            this.mstr.remove(start - 1, end)
            if (i + 1 === node.expressions.length) {
                continue
            }
            this.mstr.update(end, end + 2, ', ')
        }
        const nTxt = new NestText(txt, txt0.scope, this.context)
        let repl = `${rtFunc}(${this.index.get(nTxt.toKey())}`
        if (node.expressions.length) {
            repl += ', '
        }
        this.mstr.update(start0 - 1, end0 + 2, repl)
        // @ts-ignore
        this.mstr.update(node.end - 1, node.end, ')')
        txts.push(nTxt)
        return txts
    }


    /**
     * @param {import("svelte/compiler").AST.ExpressionTag} node
     * @returns {NestText[]}
     */
    visitExpressionTag = node => this.visit(node.expression)

    /**
     * @param {import("svelte/compiler").AST.ElementLike} node
     * @returns {boolean}
     */
    checkHasCompoundText = node => {
        let text = false
        let nonText = false
        for (const child of node.fragment.nodes ?? []) {
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

    /**
     * @typedef {import("svelte/compiler").AST.ElementLike & {inCompoundText: boolean}} ElementNode
     * @param {ElementNode & {
     *  fragment: import("svelte/compiler").AST.Fragment & {
     *   nodes: ElementNode[]
     *  },
     * }} node
     * @returns {NestText[]}
     */
    visitRegularElement = node => {
        const txts = []
        for (const attrib of node.attributes) {
            txts.push(...this.visit(attrib))
        }
        if (node.fragment.nodes.length === 0) {
            return txts
        }
        let hasTextChild = false
        let hasNonTextChild = false
        const textNodesToModify = {}
        for (const [i, child] of node.fragment.nodes.entries()) {
            if (child.type === 'Text') {
                const [pass, modify] = this.checkHeuristic(child.data, 'markup')
                if (pass) {
                    hasTextChild = true
                    textNodesToModify[i] = modify
                } else if (i === 0 && modify != null) { // non whitespace
                    return txts // explicitly to ignore
                }
            } else if (child.type !== 'Comment') {
                hasNonTextChild = true
            }
            // no break because of textNodesToModify, already started, finish it
        }
        let hasCompoundText = hasTextChild && hasNonTextChild
        let txt = ''
        let iArg = 0
        let iTag = 0
        const lastChildEnd = node.fragment.nodes.slice(-1)[0].end
        for (const [i, child] of node.fragment.nodes.entries()) {
            if (child.type === 'Comment') {
                continue
            }
            if (child.type === 'Text') {
                const modify = textNodesToModify[i]
                if (modify == null) { // whitespace
                    continue
                }
                txt += ' ' + modify
                if (node.inCompoundText && node.fragment.nodes.length === 1) {
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
            if (child.type === 'ExpressionTag') {
                txts.push(...this.visitExpressionTag(child))
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
            // @ts-ignore
            child.inCompoundText = true
            let chTxt = ''
            for (const txt of this.visit(child)) {
                if (['RegularElement', 'Component'].includes(child.type) && txt.scope === 'markup') {
                    chTxt += txt.toString()
                } else { // attributes, blocks
                    txts.push(txt)
                }
            }
            if (['RegularElement', 'Component'].includes(child.type)) {
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
        const nTxt = new NestText(txt, 'markup', this.context)
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
                begin += `id={${this.index.get(nTxt.toKey())}}`
            }
            let end = ' />\n'
            if (iArg > 0) {
                begin += ' args={['
                end = ']}' + end
            }
            this.mstr.appendLeft(lastChildEnd, begin)
            this.mstr.appendRight(lastChildEnd, end)
        } else if (!node.inCompoundText) {
            this.mstr.appendLeft(lastChildEnd, `{${rtFunc}(${this.index.get(nTxt.toKey())}, `)
            this.mstr.appendRight(lastChildEnd, ')}')
        }
        return txts
    }

    visitComponent = this.visitRegularElement

    /**
     * @param {import("svelte/compiler").AST.Text} node
     * @returns {NestText[]}
     */
    visitText = node => {
        const [pass, txt] = this.checkHeuristic(node.data, 'markup')
        if (!pass) {
            return []
        }
        txt.context = this.context
        this.mstr.update(node.start, node.end, `{${rtFunc}(${this.index.get(txt.toKey())})}`)
        return [txt]
    }

    /**
     * @param {import("svelte/compiler").AST.SpreadAttribute} node
     * @returns {NestText[]}
     */
    visitSpreadAttribute = node => {
        return this.visit(node.expression)
    }

    /**
     * @param {import("svelte/compiler").AST.Attribute} node
     * @returns {NestText[]}
     */
    visitAttribute = node => {
        if (node.value === true) {
            return []
        }
        const txts = []
        let values
        if (Array.isArray(node.value)) {
            values = node.value
        } else {
            values = [node.value]
        }
        for (const value of values) {
            if (value.type !== 'Text') { // ExpressionTag
                txts.push(...this.visit(value))
                continue
            }
            // Text
            const {start, end} = value
            const [pass, txt] = this.checkHeuristic(value.data, 'attribute')
            if (!pass) {
                continue
            }
            txt.context = this.context
            txts.push(txt)
            this.mstr.update(value.start, value.end, `{${rtFunc}(${this.index.get(txt.toKey())})}`)
            if (!`'"`.includes(this.content[start - 1])) {
                continue
            }
            this.mstr.remove(start - 1, start)
            this.mstr.remove(end, end + 1)
        }
        return txts
    }

    /**
     * @param {import("svelte/compiler").AST.Fragment} node
     * @returns {NestText[]}
     */
    visitFragment = node => {
        const txts = []
        for (const child of node.nodes) {
            txts.push(...this.visit(child))
        }
        return txts
    }

    /**
     * @param {import("svelte/compiler").AST.SnippetBlock} node
     * @returns {NestText[]}
     */
    visitSnippetBlock = node => this.visitFragment(node.body)

    /**
     * @param {import("svelte/compiler").AST.IfBlock} node
     * @returns {NestText[]}
     */
    visitIfBlock = node => {
        const txts = this.visit(node.test)
        txts.push(...this.visit(node.consequent))
        if (node.alternate) {
            txts.push(...this.visit(node.alternate))
        }
        return txts
    }

    /**
     * @param {import("svelte/compiler").AST.EachBlock} node
     * @returns {NestText[]}
     */
    visitEachBlock = node => {
        const txts = [
            ...this.visit(node.expression),
            ...this.visit(node.body),
        ]
        if (node.fallback) {
            txts.push(...this.visit(node.fallback),)
        }
        if (node.key) {
            txts.push(...this.visit(node.key),)
        }
        return txts
    }

    /**
     * @param {import("svelte/compiler").AST.KeyBlock} node
     * @returns {NestText[]}
     */
    visitKeyBlock = node => {
        return [
            ...this.visit(node.expression),
            ...this.visit(node.fragment),
        ]
    }

    /**
     * @param {import("svelte/compiler").AST.AwaitBlock} node
     * @returns {NestText[]}
     */
    visitAwaitBlock = node => {
        const txts = [
            ...this.visit(node.expression),
            ...this.visitFragment(node.then),
        ]
        if (node.pending) {
            txts.push(...this.visitFragment(node.pending),)
        }
        if (node.catch) {
            txts.push(...this.visitFragment(node.catch),)
        }
        return txts
    }

    /**
     * @param {import('estree').Program} node
     * @returns {NestText[]}
     */
    visitProgram = (node, needImport = true) => {
        const txts = []
        for (const child of node.body) {
            txts.push(...this.visit(child))
        }
        if (needImport) {
            const importStmt = `import {${rtFunc}} from "${this.importFrom}"\n`
            // @ts-ignore
            this.mstr.appendRight(node.start, importStmt)
        }
        return txts
    }

    /**
     * @param {import("svelte/compiler").AST.Root} node
     * @returns {NestText[]}
     */
    visitRoot = node => {
        const txts = this.visitFragment(node.fragment)
        if (node.instance) {
            txts.push(...this.visitProgram(node.instance.content, false))
        }
        // @ts-ignore: module is a reserved keyword, not sure how to specify the type
        if (node.module) {
            // @ts-ignore
            txts.push(...this.visitProgram(node.module.content, false))
        }
        const importStmt = `import ${rtComponent}, {${rtFunc}} from "${this.importFrom}"\n`
        if (node.instance) {
            // @ts-ignore
            this.mstr.appendRight(node.instance.content.start, importStmt)
        } else if (node.module) {
            // @ts-ignore
            this.mstr.appendRight(node.module.content.start, importStmt)
        } else {
            this.mstr.prepend(`<script>${importStmt}</script>\n`)
        }
        return txts
    }

    /**
     * @param {string} data
     */
    processCommentDirectives = data => {
        if (data === '@wc-ignore') {
            this.forceInclude = false
        }
        if (data === '@wc-include') {
            this.forceInclude = true
        }
        const ctxStart = '@wc-context:'
        if (data.startsWith(ctxStart)) {
            this.context = data.slice(ctxStart.length).trim()
        }
    }

    /**
     * @param {import("svelte/compiler").AST.SvelteNode & import('estree').BaseNode} node
     * @returns {NestText[]}
     */
    visit = node => {
        if (node.type === 'Comment') {
            this.processCommentDirectives(node.data.trim())
            return []
        }
        // for estree
        for (const comment of node.leadingComments ?? []) {
            this.processCommentDirectives(comment.value.trim())
        }
        let txts = []
        if (this.forceInclude !== false) {
            const methodName = `visit${node.type}`
            if (methodName in this) {
                txts = this[methodName](node)
            }
        }
        this.forceInclude = null
        if (this.context != null) {
            for (const txt of txts) {
                txt.context = this.context
            }
        }
        this.context = null
        return txts
    }

    /**
     * @param {string} content
     * @param {import('estree').Program | import("svelte/compiler").AST.Root} ast
     * @returns {NestText[]}
     */
    process = (content, ast) => {
        this.content = content
        this.mstr = new MagicString(content)
        return this.visit(ast)
    }
}
