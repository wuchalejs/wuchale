import MagicString from 'magic-string'
import { Parser } from 'acorn'
import { Message } from 'wuchale'
import { tsPlugin } from '@sveltejs/acorn-typescript'
import type * as JX from 'estree-jsx'
import type * as Estree from 'acorn'
import { Transformer, scriptParseOptionsWithComments } from 'wuchale/adapter-vanilla'
import type {
    IndexTracker,
    HeuristicFunc,
    TransformOutput,
    RuntimeConf,
    CatalogExpr,
} from 'wuchale'
import { nonWhitespaceText, MixedVisitor, processCommentDirectives, type CommentDirectives } from "wuchale/adapter-utils"
import type { AnyNode } from 'acorn'

const JsxParser = Parser.extend(tsPlugin({jsx: true}))

export function parseScript(content: string): [Estree.Program, Estree.Comment[][]] {
    const [opts, comments] = scriptParseOptionsWithComments()
    return [JsxParser.parse(content, opts), comments]
}

const nodesWithChildren = ['JSXElement']
const rtComponent = 'W_tx_'

type MixedNodesTypes = JX.JSXElement | JX.JSXFragment | JX.JSXText | JX.JSXExpressionContainer | JX.JSXSpreadChild

export type JSXLib = 'default' | 'solidjs'

export class JSXTransformer extends Transformer {

    // state
    currentElement?: string
    inCompoundText: boolean = false
    commentDirectivesStack: CommentDirectives[] = []
    lastVisitIsComment: boolean = false
    currentJsxKey?: number

    mixedVisitor: MixedVisitor<MixedNodesTypes>

    constructor(content: string, filename: string, index: IndexTracker, heuristic: HeuristicFunc, pluralsFunc: string, catalogExpr: CatalogExpr, rtConf: RuntimeConf) {
        super(content, filename, index, heuristic, pluralsFunc, catalogExpr, rtConf)
    }

    initMixedVisitor = () => new MixedVisitor<MixedNodesTypes>({
        mstr: this.mstr,
        vars: this.vars,
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
        checkHeuristic: this.checkHeuristicBool,
        index: this.index,
        wrapNested: (msgInfo, hasExprs, nestedRanges, lastChildEnd) => {
            let begin = `<${rtComponent}`
            if (nestedRanges.length > 0) {
                for (const [i, [childStart, _, haveCtx]] of nestedRanges.entries()) {
                    let toAppend: string
                    if (i === 0) {
                        toAppend = `${begin} t={[`
                    } else {
                        toAppend = ', '
                    }
                    this.mstr.appendRight(childStart, `${toAppend}${haveCtx ? this.vars().nestCtx : '()'} => `)
                }
                begin = `]}`
            }
            begin += ' x='
            if (this.inCompoundText) {
                begin += `{${this.vars().nestCtx}} n`
            } else {
                const index = this.index.get(msgInfo.toKey())
                begin += `{${this.vars().rtCtx}(${index})}`
            }
            let end = ' />'
            if (hasExprs) {
                begin += ' a={['
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
        scope: 'markup',
        element: this.currentElement,
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
        if (this.inCompoundText && this.currentJsxKey != null) {
            const key = node.openingElement.attributes.find(attr => attr.type === 'JSXAttribute' && attr.name.name === 'key')
            if (!key) {
                this.mstr.appendLeft(
                    // @ts-expect-error
                    node.openingElement.name.end,
                    ` key="_${this.currentJsxKey}"`
                )
                this.currentJsxKey++
            }
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
            `{${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`,
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
        return this.visit(node.expression as Estree.Expression)
    }

    visitJSXAttribute = (node: JX.JSXAttribute): Message[] => {
        if (node.value == null) {
            return []
        }
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
            `{${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`,
        )
        return [msgInfo]
    }

    visitJSXSpreadAttribute = (node: JX.JSXSpreadAttribute): Message[] => this.visit(node.argument as Estree.Expression)

    visitJSXEmptyExpression = (node: JX.JSXEmptyExpression): Message[] => {
        const commentContents = this.getMarkupCommentBody(node)
        if (!commentContents) {
            return []
        }
        this.commentDirectives = processCommentDirectives(commentContents, this.commentDirectives)
        if (this.lastVisitIsComment) {
            this.commentDirectivesStack[this.commentDirectivesStack.length - 1] = this.commentDirectives
        } else {
            this.commentDirectivesStack.push(this.commentDirectives)
        }
        this.lastVisitIsComment = true
        return []
    }

    visitJx = (node: JX.Node | JX.JSXSpreadChild | Estree.Program): Message[] => {
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
        if (this.commentDirectives.ignoreFile) {
            return []
        }
        if (this.commentDirectives.forceInclude !== false) {
            msgs = this.visit(node as AnyNode)
        }
        this.commentDirectives = commentDirectivesPrev
        return msgs
    }

    transformJx = (lib: JSXLib): TransformOutput => {
        const [ast, comments] = parseScript(this.content)
        this.comments = comments
        this.mstr = new MagicString(this.content)
        this.mixedVisitor = this.initMixedVisitor()
        if (lib === 'default') {
            this.currentJsxKey = 0
        }
        const msgs = this.visitJx(ast)
        const header = [
            `import ${rtComponent} from "@wuchale/jsx/runtime${lib === 'solidjs' ? '.solid' : ''}.jsx"`,
            this.initRuntime(this.filename, null, null, {}),
        ].join('\n')
        const bodyStart = this.getRealBodyStart(ast.body)
        return this.finalize(msgs, bodyStart, header)
    }
}
