// $$ cd .. && npm run test

import MagicString from "magic-string"
import type { ItemType } from "./gemini.js"
import type { AST } from "svelte/compiler"
import type Estree from 'estree'
import type { Program, AnyNode } from "acorn"

type ElementNode = AST.ElementLike & { inCompoundText: boolean }

type TxtScope = "script" | "markup" | "attribute"

type HeuristicDetails = {
    scope: TxtScope,
    element?: string,
    attribute?: string,
}

export type HeuristicFunc = (text: string, details: HeuristicDetails) => boolean

export function defaultHeuristic(text: string, details: HeuristicDetails) {
    if (details.scope === 'markup') {
        return true
    }
    if (details.element === 'path') { // ignore attributes for svg path
        return false
    }
    // script and attribute
    const range = 'AZ'
    const startCode = text.charCodeAt(0)
    return startCode >= range.charCodeAt(0) && startCode <= range.charCodeAt(1)
}

const snipPrefix = 'wuchaleSnippet'
const nodesWithChildren = ['RegularElement', 'Component']
const rtComponent = 'WuchaleTrans'
const rtFunc = 'wuchaleTrans'
const rtFuncCtx = 'wuchaleTransCtx'
const rtFuncPlural = 'wuchaleTransPlural'
const rtPluralsRule = 'wuchalePluralsRule'
const importModule = `import {${rtFunc}, ${rtFuncCtx}, ${rtFuncPlural}, ${rtPluralsRule}} from "wuchale/runtime.svelte.js"`
const importComponent = `import ${rtComponent} from "wuchale/runtime.svelte"`

export class NestText {

    text: string[] // array for plurals
    plural: boolean = false
    scope: TxtScope
    context: string

    constructor(txt: string | string[], scope: TxtScope, context: string | null) {
        if (typeof txt === 'string') {
            this.text = [txt]
        } else {
            this.text = txt
        }
        this.scope = scope
        this.context = context ?? null
    }

    toKey = () => `${this.text.slice(0, 2).join('\n')}\n${this.context ?? ''}`.trim()

}

export interface Translations {
    [key: string]: ItemType
}

export class IndexTracker {

    indices: { [key: string]: number } = {}
    nextIndex: number = 0

    constructor(sourceTranslations: Translations) {
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
    heuristic: HeuristicFunc
    content: string = ''
    mstr: MagicString
    currentSnippet: number = 0
    pluralFunc: string

    // state
    forceInclude: boolean | null = null
    context: string | null = null
    insideFunc: boolean = false
    currentElement: ElementNode

    constructor(index: IndexTracker, heuristic: HeuristicFunc = defaultHeuristic, pluralsFunc: string = 'plural') {
        this.index = index
        this.heuristic = heuristic
        this.pluralFunc = pluralsFunc
    }

    checkHeuristic = (text: string, details: HeuristicDetails, trim = false): [boolean, NestText] => {
        if (text.trim() === '') {
            // nothing to ask
            return [false, null]
        }
        if (trim) {
            text = text.trim()
        }
        const extract = this.forceInclude || this.heuristic(text, details)
        return [extract, new NestText(text, details.scope, this.context)]
    }

    visitLiteral = (node: Estree.Literal & { start: number; end: number }): NestText[] => {
        if (typeof node.value !== 'string') {
            return []
        }
        const { start, end } = node
        const [pass, txt] = this.checkHeuristic(node.value, {scope: 'script'})
        if (!pass) {
            return []
        }
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
            txts.push(...this.visit(prop))
        }
        return txts
    }

    visitProperty = (node: Estree.Property): NestText[] => [
        ...this.visit(node.key),
        ...this.visit(node.value),
    ]

    visitSpreadElement = (node: Estree.SpreadElement): NestText[] => this.visit(node.argument)

    visitMemberExpression = (node: Estree.MemberExpression): NestText[] => [
        ...this.visit(node.object),
        ...this.visit(node.property),
    ]

    visitNewExpression = (node: Estree.NewExpression): NestText[] => node.arguments.map(this.visit).flat()

    defaultVisitCallExpression = (node: Estree.CallExpression): NestText[] => {
        const txts = [...this.visit(node.callee)]
        for (const arg of node.arguments) {
            txts.push(...this.visit(arg))
        }
        return txts
    }

    visitCallExpression = (node: Estree.CallExpression): NestText[] => {
        if (node.callee.type !== 'Identifier' || node.callee.name !== this.pluralFunc) {
            return this.defaultVisitCallExpression(node)
        }
        // plural(num, ['Form one', 'Form two'])
        const secondArg = node.arguments[1]
        if (secondArg === null || secondArg.type !== 'ArrayExpression') {
            return this.defaultVisitCallExpression(node)
        }
        const candidates = []
        for (const elm of secondArg.elements) {
            if (elm.type !== 'Literal' || typeof elm.value !== 'string') {
                return this.defaultVisitCallExpression(node)
            }
            candidates.push(elm.value)
        }
        const nTxt = new NestText(candidates, 'script', this.context)
        nTxt.plural = true
        const index = this.index.get(nTxt.toKey())
        // @ts-ignore
        this.mstr.update(secondArg.start, node.end - 1, `${rtFuncPlural}(${index}), ${rtPluralsRule}()`)
        return [nTxt]
    }

    visitBinaryExpression = (node: Estree.BinaryExpression): NestText[] => [
        ...this.visit(node.left),
        ...this.visit(node.right),
    ]

    visitUnaryExpression = (node: Estree.UnaryExpression): NestText[] => this.visit(node.argument)

    visitAwaitExpression = (node: Estree.AwaitExpression): NestText[] => this.visit(node.argument)

    visitAssignmentExpression = this.visitBinaryExpression

    visitExpressionStatement = (node: Estree.ExpressionStatement): NestText[] => this.visit(node.expression)

    visitForOfStatement = (node: Estree.ForOfStatement): NestText[] => [
        ...this.visit(node.left),
        ...this.visit(node.right),
        ...this.visit(node.body),
    ]

    visitForInStatement = (node: Estree.ForInStatement): NestText[] => [
        ...this.visit(node.left),
        ...this.visit(node.right),
        ...this.visit(node.body),
    ]

    visitForStatement = (node: Estree.ForStatement): NestText[] => [
        ...this.visit(node.init),
        ...this.visit(node.test),
        ...this.visit(node.update),
        ...this.visit(node.body),
    ]

    visitVariableDeclaration = (node: Estree.VariableDeclaration): NestText[] => {
        const txts = []
        let atTopLevel = !this.insideFunc
        for (const dec of node.declarations) {
            if (!dec.init) {
                continue
            }
            // visit only contents inside $derived or functions
            if (atTopLevel) {
                if (dec.init.type === 'CallExpression') {
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
                } else if (dec.init.type !== 'ArrowFunctionExpression') {
                    continue
                } else {
                }
                this.insideFunc = true
            }
            const decVisit = this.visit(dec.init)
            if (!decVisit.length) {
                continue
            }
            txts.push(...decVisit)
        }
        if (atTopLevel) {
            this.insideFunc = false
        }
        return txts
    }

    visitExportNamedDeclaration = (node: Estree.ExportNamedDeclaration): NestText[] => node.declaration ? this.visit(node.declaration) : []

    visitFunctionDeclaration = (node: Estree.FunctionDeclaration): NestText[] => {
        const insideFunc = this.insideFunc
        this.insideFunc = true
        const txts = this.visit(node.body)
        if (!insideFunc) {
            this.insideFunc = false
        }
        return txts
    }

    visitArrowFunctionExpression = (node: Estree.ArrowFunctionExpression): NestText[] => this.visit(node.body)

    visitBlockStatement = (node: Estree.BlockStatement): NestText[] => {
        const txts = []
        for (const statement of node.body) {
            txts.push(...this.visit(statement))
        }
        return txts
    }

    visitReturnStatement = (node: Estree.ReturnStatement): NestText[] => {
        if (node.argument) {
            return this.visit(node.argument)
        }
        return []
    }

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
        const [pass, txt0] = this.checkHeuristic(quasi0.value.cooked, {scope: 'script'})
        if (!pass) {
            return txts
        }
        let txt = txt0.text[0]
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
        let begin = `${rtFunc}(${this.index.get(nTxt.toKey())}`
        let end = ')'
        if (node.expressions.length) {
            begin += ', ['
            end = ']' + end
        }
        this.mstr.update(start0 - 1, end0 + 2, begin)
        // @ts-ignore
        this.mstr.update(node.end - 1, node.end, end)
        txts.push(nTxt)
        return txts
    }


    visitExpressionTag = (node: AST.ExpressionTag): NestText[] => this.visit(node.expression)

    visitRegularElementCore = (node: ElementNode): NestText[] => {
        const txts: NestText[] = []
        for (const attrib of node.attributes) {
            txts.push(...this.visit(attrib))
        }
        if (node.fragment.nodes.length === 0) {
            return txts
        }
        let hasTextChild = false
        let hasNonTextChild = false
        const textNodesToModify: NestText[] = []
        for (const [i, child] of node.fragment.nodes.entries()) {
            if (child.type === 'Text') {
                const [pass, nTxt] = this.checkHeuristic(child.data, {scope: 'markup', element: node.name}, true)
                if (pass) {
                    hasTextChild = true
                    textNodesToModify[i] = nTxt
                } else if (i === 0 && nTxt != null) { // non whitespace
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
        const childrenForSnippets: [number, number, boolean][] = []
        let hasTextDescendants = false
        for (const [i, child] of node.fragment.nodes.entries()) {
            if (child.type === 'Comment') {
                continue
            }
            if (child.type === 'Text') {
                const nTxt = textNodesToModify[i]
                if (nTxt == null) { // whitespace
                    continue
                }
                txt += ' ' + nTxt.text
                this.mstr.remove(child.start, child.end)
                continue
            }
            if (!node.inCompoundText && !hasCompoundText) {
                txts.push(...this.visit(child))
                continue
            }
            if (child.type === 'ExpressionTag') {
                txts.push(...this.visitExpressionTag(child))
                if (!hasCompoundText) {
                    continue
                }
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
            let snippNeedsCtx = false
            let chTxt = ''
            for (const txt of this.visit(child)) {
                if (nodesWithChildren.includes(child.type) && txt.scope === 'markup') {
                    chTxt += txt.text[0]
                    hasTextDescendants = true
                    snippNeedsCtx = true
                } else { // attributes, blocks
                    txts.push(txt)
                }
            }
            childrenForSnippets.push([child.start, child.end, snippNeedsCtx])
            if (nodesWithChildren.includes(child.type) && chTxt) {
                chTxt = `<${iTag}>${chTxt}</${iTag}>`
            } else {
                // childless elements and everything else
                chTxt = `<${iTag}/>`
            }
            iTag++
            if (chTxt && !txt.endsWith(' ')) {
                txt += ' '
            }
            txt += chTxt
        }
        txt = txt.trim()
        if (!txt) {
            return txts
        }
        const nTxt = new NestText(txt, 'markup', this.context)
        if (hasTextChild || hasTextDescendants) {
            txts.push(nTxt)
        } else {
            return txts
        }
        if (childrenForSnippets.length) {
            const snippets = []
            // create and reference snippets
            for (const [childStart, childEnd, haveCtx] of childrenForSnippets) {
                const snippetName = `${snipPrefix}${this.currentSnippet}`
                snippets.push(snippetName)
                this.currentSnippet++
                const snippetBegin = `\n{#snippet ${snippetName}(${haveCtx ? 'ctx' : ''})}\n`
                this.mstr.appendRight(childStart, snippetBegin)
                this.mstr.prependLeft(childEnd, '\n{/snippet}')
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
        } else if (hasTextChild) {
            // no need for component use
            let begin = '{'
            let end = ')}'
            if (node.inCompoundText) {
                begin += `${rtFuncCtx}(ctx`
            } else {
                begin += `${rtFunc}(${this.index.get(nTxt.toKey())}`
            }
            if (iArg) {
                begin += ', ['
                end = ']' + end
            }
            this.mstr.appendLeft(lastChildEnd, begin)
            this.mstr.appendRight(lastChildEnd, end)
        }
        return txts
    }

    visitRegularElement = (node: ElementNode): NestText[] => {
        const currentElement = this.currentElement
        this.currentElement = node
        const txts = this.visitRegularElementCore(node)
        this.currentElement = currentElement
        return txts
    }

    visitComponent = this.visitRegularElement

    visitText = (node: AST.Text): NestText[] => {
        const [pass, txt] = this.checkHeuristic(node.data, {scope: 'markup'}, true)
        if (!pass) {
            return []
        }
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
            const [pass, txt] = this.checkHeuristic(value.data, {
                scope: 'attribute',
                element: this.currentElement.name,
                attribute: node.name,
            })
            if (!pass) {
                continue
            }
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
        for (const child of node?.nodes ?? []) {
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

    visit = (node: AST.SvelteNode | AnyNode): NestText[] => {
        if (node.type === 'Comment') {
            this.processCommentDirectives(node.data.trim())
            return []
        }
        if ('leadingComments' in node) {
            // for estree
            for (const comment of node.leadingComments) {
                this.processCommentDirectives(comment.value.trim())
            }
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
        if (txts.length) { // if the context was used
            this.context = null
        }
        return txts
    }

    process = (content: string, ast: Program | AST.Root): NestText[] => {
        this.content = content
        this.mstr = new MagicString(content)
        return this.visit(ast)
    }
}
