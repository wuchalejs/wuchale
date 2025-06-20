// $$ cd .. && npm run build && npm run test

import MagicString from "magic-string"
import type { ItemType } from "./gemini.js"
import type { AST } from "svelte/compiler"
import type Estree from 'estree'

export type HeuristicFunc = (text: string, scope: TxtScope) => boolean

type TxtScope = "script" | "markup" | "attribute"

type ElementNode = AST.ElementLike & { inCompoundText: boolean }

const snipPrefix = 'wuchaleSnippet'
const nodesWithChildren = ['RegularElement', 'Component']
const rtComponent = 'WuchaleTrans'
const rtFunc = 'wuchaleTrans'
const importModule = `import {${rtFunc}} from "wuchale/runtime.svelte.js"`
const importComponent = `import ${rtComponent} from "wuchale/runtime.svelte"`

export function defaultHeuristic(text: string, scope = 'markup') {
    if (scope === 'markup') {
        return true
    }
    // script and attribute
    const range = 'AZ'
    const startCode = text.charCodeAt(0)
    return startCode >= range.charCodeAt(0) && startCode <= range.charCodeAt(1)
}

export class NestText extends String {

    scope: TxtScope
    context: string

    constructor(txt: string, scope: TxtScope, context: string | null = null) {
        super(txt)
        this.scope = scope
        this.context = context ?? null
    }

    toKey = () => `${this.toString()}\n${this.context ?? ''}`.trim()

}

export interface Translations {
    [key: string]: ItemType
}

export class IndexTracker {

    indices: { [key: string]: number }
    nextIndex: number

    constructor(sourceTranslations: Translations) {
        this.indices = {}
        this.nextIndex = 0
        for (const txt of Object.keys(sourceTranslations)) {
            // guaranteed order for strings since ES2015
            this.indices[txt] = this.nextIndex
            this.nextIndex++
        }
    }

    get = (txt: string) => {
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

    index: IndexTracker
    importFrom: string
    heuristic: HeuristicFunc
    content: string
    mstr: MagicString
    forceInclude: boolean | null
    context: string
    insideDerived: boolean = false

    constructor(index: IndexTracker, heuristic: HeuristicFunc = defaultHeuristic, importFrom: string = '') {
        this.index = index
        this.importFrom = importFrom
        this.heuristic = heuristic
        this.content = ''
        this.mstr = null
        this.forceInclude = null
        this.content = null
    }

    checkHeuristic = (text: string, scope: TxtScope): [boolean, NestText] => {
        text = text.replace(/\s+/g, ' ').trim()
        if (text === '') {
            // nothing to ask
            return [false, null]
        }
        const extract = this.forceInclude || this.heuristic(text, scope)
        return [extract, new NestText(text, scope)]
    }

    visitLiteral = (node: Estree.Literal & { start: number; end: number }): NestText[] => {
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

    visitArrayExpression = (node: Estree.ArrayExpression): NestText[] => {
        const txts = []
        for (const elm of node.elements) {
            txts.push(...this.visit(elm))
        }
        return txts
    }

    visitObjectExpression = (node: Estree.ObjectExpression): NestText[] => {
        const txts = []
        for (const prop of node.properties) {
            // @ts-ignore
            txts.push(...this.visit(prop.key))
            // @ts-ignore
            txts.push(...this.visit(prop.value))
        }
        return txts
    }

    visitMemberExpression = (node: Estree.MemberExpression): NestText[] => {
        return [
            ...this.visit(node.object),
            ...this.visit(node.property),
        ]
    }

    visitCallExpression = (node: Estree.CallExpression): NestText[] => {
        const txts = [...this.visit(node.callee)]
        for (const arg of node.arguments) {
            txts.push(...this.visit(arg))
        }
        return txts
    }

    visitBinaryExpression = (node: Estree.BinaryExpression): NestText[] => {
        return [
            ...this.visit(node.left),
            ...this.visit(node.right),
        ]
    }

    visitAssignmentExpression = this.visitBinaryExpression

    visitExpressionStatement = (node: Estree.ExpressionStatement): NestText[] => this.visit(node.expression)

    visitForOfStatement = (node: Estree.ForOfStatement): NestText[] => {
        return [
            ...this.visit(node.left),
            ...this.visit(node.right),
            ...this.visit(node.body),
        ]
    }

    visitForInStatement = (node: Estree.ForInStatement): NestText[] => {
        return [
            ...this.visit(node.left),
            ...this.visit(node.right),
            ...this.visit(node.body),
        ]
    }

    visitStatement = (node: Estree.ForStatement): NestText[] => {
        return [
            ...this.visit(node.init),
            ...this.visit(node.test),
            ...this.visit(node.update),
            ...this.visit(node.body),
        ]
    }

    visitVariableDeclaration = (node: Estree.VariableDeclaration): NestText[] => {
        const txts = []
        let atTopLevel = !this.insideDerived
        for (const dec of node.declarations) {
            if (!dec.init) {
                continue
            }
            // visit only contents inside $derived
            if (atTopLevel) {
                if (dec.init.type !== 'CallExpression') {
                    continue
                }
                const callee = dec.init.callee
                const isDerived = callee.type === 'Identifier' && callee.name === '$derived'
                const isDerivedBy = callee.type === 'MemberExpression'
                    && callee.object.type === 'Identifier'
                    && callee.object.name === '$derived'
                    && callee.property.type === 'Identifier'
                    && callee.property.name === 'by'
                if (!isDerived && !isDerivedBy) {
                    continue
                }
                this.insideDerived = true
            }
            const decVisit = this.visit(dec.init)
            if (!decVisit.length) {
                continue
            }
            txts.push(...decVisit)
        }
        if (atTopLevel) {
            this.insideDerived = false
        }
        return txts
    }

    visitExportDefaultDeclaration = (node: Estree.ExportDefaultDeclaration): NestText[] => this.visit(node.declaration)

    visitArrowFunctionExpression = (node: Estree.ArrowFunctionExpression): NestText[] => this.visit(node.body)

    visitBlockStatement = (node: Estree.BlockStatement): NestText[] => {
        const txts = []
        for (const statement of node.body) {
            txts.push(...this.visit(statement))
        }
        return txts
    }

    visitReturnStatement = (node: Estree.ReturnStatement): NestText[] => this.visit(node.argument)

    visitIfStatement = (node: Estree.IfStatement): NestText[] => {
        const txts = this.visit(node.test)
        txts.push(...this.visit(node.consequent))
        if (node.alternate) {
            txts.push(...this.visit(node.alternate))
        }
        return txts
    }

    visitTemplateLiteral = (node: Estree.TemplateLiteral): NestText[] => {
        const txts = []
        const quasi0 = node.quasis[0]
        // @ts-ignore
        const { start: start0, end: end0 } = quasi0
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
            const { start, end } = quasi
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


    visitExpressionTag = (node: AST.ExpressionTag): NestText[] => this.visit(node.expression)

    checkHasCompoundText = (node: AST.ElementLike): boolean => {
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

    visitRegularElement = (node: ElementNode & {
        fragment: AST.Fragment & {
            nodes: ElementNode[]
        }
    }): NestText[] => {
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
                if (nodesWithChildren.includes(child.type) && txt.scope === 'markup') {
                    chTxt += txt.toString()
                } else { // attributes, blocks
                    txts.push(txt)
                }
            }
            if (nodesWithChildren.includes(child.type)) {
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

    visitText = (node: AST.Text): NestText[] => {
        const [pass, txt] = this.checkHeuristic(node.data, 'markup')
        if (!pass) {
            return []
        }
        txt.context = this.context
        this.mstr.update(node.start, node.end, `{${rtFunc}(${this.index.get(txt.toKey())})}`)
        return [txt]
    }

    visitSpreadAttribute = (node: AST.SpreadAttribute): NestText[] => {
        return this.visit(node.expression)
    }

    visitAttribute = (node: AST.Attribute): NestText[] => {
        if (node.value === true) {
            return []
        }
        const txts = []
        let values: (AST.ExpressionTag | AST.Text)[]
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
            const { start, end } = value
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

    visitFragment = (node: AST.Fragment): NestText[] => {
        const txts = []
        for (const child of node.nodes) {
            txts.push(...this.visit(child))
        }
        return txts
    }

    visitSnippetBlock = (node: AST.SnippetBlock): NestText[] => this.visitFragment(node.body)

    visitIfBlock = (node: AST.IfBlock): NestText[] => {
        const txts = this.visit(node.test)
        txts.push(...this.visit(node.consequent))
        if (node.alternate) {
            txts.push(...this.visit(node.alternate))
        }
        return txts
    }

    visitEachBlock = (node: AST.EachBlock): NestText[] => {
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

    visitKeyBlock = (node: AST.KeyBlock): NestText[] => {
        return [
            ...this.visit(node.expression),
            ...this.visit(node.fragment),
        ]
    }

    visitAwaitBlock = (node: AST.AwaitBlock): NestText[] => {
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

    visitProgram = (node: Estree.Program, needImport = true): NestText[] => {
        const txts = []
        for (const child of node.body) {
            txts.push(...this.visit(child))
        }
        if (needImport) {
            // @ts-ignore
            this.mstr.appendRight(node.start, importModule + '\n')
        }
        return txts
    }

    visitRoot = (node: AST.Root): NestText[] => {
        const txts = this.visitFragment(node.fragment)
        if (node.instance) {
            txts.push(...this.visitProgram(node.instance.content, false))
        }
        // @ts-ignore: module is a reserved keyword, not sure how to specify the type
        if (node.module) {
            // @ts-ignore
            txts.push(...this.visitProgram(node.module.content, false))
        }
        const importStmt = `\n${importModule}\n${importComponent}\n`
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

    processCommentDirectives = (data: string) => {
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

    visit = (node: AST.SvelteNode & Estree.BaseNode): NestText[] => {
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
            // } else {
            //     console.log(node)
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

    process = (content: string, ast: Estree.Program | AST.Root): NestText[] => {
        this.content = content
        this.mstr = new MagicString(content)
        return this.visit(ast)
    }
}
