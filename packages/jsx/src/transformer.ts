import MagicString from "magic-string"
import { Parser, type Program } from "acorn"
import { Message } from 'wuchale'
import { tsPlugin } from '@sveltejs/acorn-typescript'
import type * as JX from 'estree-jsx'
import jsx from 'acorn-jsx'
import { Transformer, scriptParseOptionsWithComments, initCatalogStmt as initCatalogStmtVanilla, type InitRuntimeFunc } from 'wuchale/adapter-vanilla'
import type {
    IndexTracker,
    HeuristicFunc,
    TransformOutput,
    CommentDirectives,
    Mode,
} from 'wuchale'
import { nonWhitespaceText, MixedVisitor, runtimeVars } from "wuchale/adapter-utils"

export function initCatalogStmt(catalogExpr: string, mode: Mode, lib: JSXLib): { importLine: string, stmt: InitRuntimeFunc } {
    if (mode !== 'dev') {
        return {
            importLine: '',
            stmt: () => `const ${runtimeVars.rtConst} = ${runtimeVars.rtWrap}(${catalogExpr})`
        }
    }
    const catalogVar = '_w_catalog_'
    const fallbackStmt = initCatalogStmtVanilla(catalogExpr, mode)
    if (lib === 'react') {
        const useState = '_w_useState_'
        const useEffect = '_w_useEffect_'
        return {
            importLine: `import {useState as ${useState}, useEffect as ${useEffect}} from 'react'`,
            stmt: funcName => {
                if (!funcName || !funcName.startsWith('use') || !/[A-Z]/.test(funcName[0])) {
                    return fallbackStmt(funcName)
                }
                return `
                    const [${catalogVar}, set${catalogVar}] = ${useState}({...${catalogExpr}})
                    const ${runtimeVars.rtConst} = ${runtimeVars.rtWrap}(${catalogVar})
                    ${useEffect}(() => {
                        const _w_callback_ = data => {set${catalogVar}({...${catalogVar}, c: data})}
                        ${catalogVar}.onUpdate(_w_callback_)
                        return () => { ${catalogVar}.offUpdate(_w_callback_)
                    })
                `
            }
        }
    } else if (lib === 'solidjs') {
        const createStore = '_w_createStore_'
        const createEffect = '_w_createEffect_'
        return {
            importLine: `import {createStore as ${createStore}} from 'solid-js/store'; import {createEffect as ${createEffect}} from 'solid-js'`,
            stmt: funcName => {
                if (!funcName) {
                    return fallbackStmt(funcName)
                }
                return `
                    const [${catalogVar}, set${catalogVar}] = ${createStore}({...${catalogExpr}})
                    const ${runtimeVars.rtConst} = ${runtimeVars.rtWrap}(${catalogVar})
                    ${createEffect}(() => {
                        const _w_callback_ = data => {set${catalogVar}({...${catalogVar}, c: data})}
                        ${catalogVar}.onUpdate(_w_callback_)
                        return () => { ${catalogVar}.offUpdate(_w_callback_)
                    })
                `
            }
        }
    }
    return {
        importLine: '',
        stmt: fallbackStmt,
    }
}

const JsxParser = Parser.extend(tsPlugin(), jsx())

export function parseScript(content: string): [Program, JX.Comment[][]] {
    const [opts, comments] = scriptParseOptionsWithComments()
    return [JsxParser.parse(content, opts), comments]
}

const nodesWithChildren = ['JSXElement']
const rtComponent = 'WuchaleTrans'

type MixedNodesTypes = JX.JSXElement | JX.JSXFragment | JX.JSXText | JX.JSXExpressionContainer | JX.JSXSpreadChild

export type JSXLib = 'default' | 'react' | 'solidjs'

export class JSXTransformer extends Transformer {

    // state
    currentElement?: string
    inCompoundText: boolean = false
    commentDirectivesStack: CommentDirectives[] = []
    lastVisitIsComment: boolean = false
    currentElementI = 0

    mixedVisitor: MixedVisitor<MixedNodesTypes>

    constructor(content: string, filename: string, index: IndexTracker, heuristic: HeuristicFunc, pluralsFunc: string, initRuntime: InitRuntimeFunc) {
        super(content, filename, index, heuristic, pluralsFunc, initRuntime)
    }

    initMixedVisitor = () => new MixedVisitor<MixedNodesTypes>({
        mstr: this.mstr,
        getRange: node => ({
            // @ts-expect-error
            start: node.start,
            // @ts-expect-error
            end: node.end
        }),
        isComment: node => node.type === 'JSXExpressionContainer'
            && node.expression.type === 'JSXEmptyExpression'
            // @ts-expect-error
            && node.expression.end > node.expression.start,
        isText: node => node.type === 'JSXText',
        isExpression: node => node.type === 'JSXExpressionContainer',
        getTextContent: (node: JX.JSXText) => node.value,
        getCommentData: (node: JX.JSXExpressionContainer) => this.getMarkupCommentBody(node.expression as JX.JSXEmptyExpression),
        canHaveChildren: node => nodesWithChildren.includes(node.type),
        visitFunc: (child, inCompoundText) => {
            const inCompoundTextPrev = this.inCompoundText
            this.inCompoundText = inCompoundText
            const childTxts = this.visitJx(child)
            this.inCompoundText = inCompoundTextPrev // restore
            return childTxts
        },
        visitExpressionTag: this.visitJSXExpressionContainer,
        checkHeuristic: msgStr => this.checkHeuristic(msgStr, { scope: 'markup', element: this.currentElement })[0],
        index: this.index,
        wrapNested: (msgInfo, hasExprs, nestedRanges, lastChildEnd) => {
            for (const [i, [childStart, _, haveCtx]] of nestedRanges.entries()) {
                let toAppend: string
                if (i === 0) {
                    toAppend = `<${rtComponent} tags={[`
                } else {
                    toAppend = ', '
                }
                this.mstr.appendRight(childStart, `${toAppend}${haveCtx ? runtimeVars.nestCtx : '()'} => `)
            }
            let begin = `]} ctx=`
            if (this.inCompoundText) {
                begin += `{${runtimeVars.nestCtx}} nest`
            } else {
                const index = this.index.get(msgInfo.toKey())
                begin += `{${runtimeVars.rtCtx}(${index})}`
            }
            let end = ' />'
            if (hasExprs) {
                begin += ' args={['
                end = ']}' + end
            }
            this.mstr.appendLeft(lastChildEnd, begin)
            this.mstr.appendRight(lastChildEnd, end)
        },
    })

    visitChildrenJ = (node: JX.JSXElement | JX.JSXFragment): Message[] => this.mixedVisitor.visit({
        children: node.children,
        commentDirectives: this.commentDirectives,
        inCompoundText: this.inCompoundText,
    })

    visitNameJSXNamespacedName = (node: JX.JSXNamespacedName): string => {
        return `${this.visitName(node.namespace)}:${this.visitName(node.name)}`
    }

    visitNameJSXMemberExpression = (node: JX.JSXMemberExpression): string => {
        return `${this.visitName(node.object)}.${this.visitName(node.property)}`
    }

    visitNameJSXIdentifier = (node: JX.JSXIdentifier): string => node.name

    visitName = (node: JX.JSXIdentifier | JX.JSXMemberExpression | JX.JSXNamespacedName): string => {
        return this['visitName' + node.type]?.(node)
    }

    visitJSXElement = (node: JX.JSXElement): Message[] => {
        const currentElement = this.currentElement
        this.currentElement = this.visitName(node.openingElement.name)
        const msgs = this.visitChildrenJ(node)
        for (const attr of node.openingElement.attributes) {
            msgs.push(...this.visitJx(attr))
        }
        if (this.inCompoundText) {
            this.mstr.appendLeft(
                // @ts-expect-error
                node.openingElement.name.end,
                ` key="_${this.currentElementI}"`
            )
        }
        this.currentElement = currentElement
        return msgs
    }

    visitJSXText = (node: JX.JSXText): Message[] => {
        const [startWh, trimmed, endWh] = nonWhitespaceText(node.value)
        const [pass, msgInfo] = this.checkHeuristic(trimmed, {
            scope: 'markup',
            element: this.currentElement,
        })
        if (!pass) {
            return []
        }
        this.mstr.update(
            // @ts-expect-error
            node.start + startWh,
            // @ts-expect-error
            node.end - endWh,
            `{${runtimeVars.rtTrans}(${this.index.get(msgInfo.toKey())})}`,
        )
        return [msgInfo]
    }

    visitJSXFragment = (node: JX.JSXFragment): Message[] => this.visitChildrenJ(node)

    getMarkupCommentBody = (node: JX.JSXEmptyExpression): string => {
        // @ts-expect-error
        const comment = this.content.slice(node.start, node.end).trim()
        if (!comment) {
            return ''
        }
        return comment.slice(2, -2).trim()
    }

    visitJSXExpressionContainer = (node: JX.JSXExpressionContainer): Message[] => {
        return this.visit(node.expression as JX.Expression)
    }

    visitJSXAttribute = (node: JX.JSXAttribute): Message[] => {
        if (node.value.type !== 'Literal') {
            return this.visitJx(node.value)
        }
        if (typeof node.value.value !== 'string') {
            return []
        }
        const value = node.value
        let name: string
        if (node.name.type === 'JSXIdentifier') {
            name = node.name.name
        } else {
            name = node.name.name.name
        }
        const [pass, msgInfo] = this.checkHeuristic(node.value.value, {
            scope: 'attribute',
            element: this.currentElement,
            attribute: name,
        })
        if (!pass) {
            return []
        }
        this.mstr.update(
            // @ts-expect-error
            value.start,
            // @ts-expect-error
            value.end,
            `{${runtimeVars.rtTrans}(${this.index.get(msgInfo.toKey())})}`,
        )
        return [msgInfo]
    }

    visitJSXSpreadAttribute = (node: JX.JSXSpreadAttribute): Message[] => this.visit(node.argument)

    visitJSXEmptyExpression = (node: JX.JSXEmptyExpression): Message[] => {
        const commentContents = this.getMarkupCommentBody(node)
        if (!commentContents) {
            return []
        }
        const directives = this.processCommentDirectives(commentContents)
        if (this.lastVisitIsComment) {
            this.commentDirectivesStack[this.commentDirectivesStack.length - 1] = directives
        } else {
            this.commentDirectivesStack.push(directives)
        }
        this.lastVisitIsComment = true
        return []
    }

    visitJx = (node: JX.Node | JX.JSXSpreadChild | Program): Message[] => {
        if (node.type === 'JSXText' && !node.value.trim()) {
            return []
        }
        if (node.type === 'JSXExpressionContainer' && node.expression.type === 'JSXEmptyExpression') { // markup comment
            return this.visitJSXEmptyExpression(node.expression)
        }
        let msgs = []
        const commentDirectivesPrev = this.commentDirectives
        if (this.lastVisitIsComment) {
            this.commentDirectives = this.commentDirectivesStack.pop()
            this.lastVisitIsComment = false
        }
        if (this.commentDirectives.forceInclude !== false) {
            msgs = this.visit(node)
        }
        this.commentDirectives = commentDirectivesPrev
        return msgs
    }

    transformJx = (headerHead: string, lib: JSXLib): TransformOutput => {
        const [ast, comments] = parseScript(this.content)
        this.comments = comments
        this.mstr = new MagicString(this.content)
        this.mixedVisitor = this.initMixedVisitor()
        const msgs = this.visitJx(ast)
        if (!msgs.length) {
            return this.finalize(msgs)
        }
        let devInit = ''
        const headerFin = [
            `import ${rtComponent} from "@wuchale/jsx/runtime${lib === 'solidjs' ? '.solid' : ''}.jsx"`,
            headerHead,
            devInit,
        ].join('\n')
        this.mstr.appendRight(0, headerFin + '\n')
        return this.finalize(msgs)
    }
}
