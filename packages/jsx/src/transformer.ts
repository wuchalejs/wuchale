import { tsPlugin } from '@sveltejs/acorn-typescript'
import type * as Estree from 'acorn'
import { Parser } from 'acorn'
import type * as JX from 'estree-jsx'
import MagicString from 'magic-string'
import type {
    CatalogExpr,
    CodePattern,
    HeuristicFunc,
    IndexTracker,
    Message,
    RuntimeConf,
    TransformOutput,
    UrlMatcher,
} from 'wuchale'
import { getKey } from 'wuchale'
import { MixedVisitor, nonWhitespaceText } from 'wuchale/adapter-utils'
import { parseScript, scriptParseOptionsWithComments, Transformer } from 'wuchale/adapter-vanilla'

const JsxParser = Parser.extend(tsPlugin({ jsx: true }))

export function parseScriptJSX(content: string): [Estree.Program, Estree.Comment[][]] {
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
    lastVisitIsComment: boolean = false
    currentJsxKey?: number

    mixedVisitor: MixedVisitor<MixedNodesTypes>

    constructor(
        content: string,
        filename: string,
        index: IndexTracker,
        heuristic: HeuristicFunc,
        patterns: CodePattern[],
        catalogExpr: CatalogExpr,
        rtConf: RuntimeConf,
        matchUrl: UrlMatcher,
    ) {
        super(content, filename, index, heuristic, patterns, catalogExpr, rtConf, matchUrl)
    }

    initMixedVisitor = () =>
        new MixedVisitor<MixedNodesTypes>({
            mstr: this.mstr,
            vars: this.vars,
            getRange: node => ({
                start: node.start,
                end: node.end,
            }),
            isComment: node =>
                node.type === 'JSXExpressionContainer' &&
                node.expression.type === 'JSXEmptyExpression' &&
                node.expression.end > node.expression.start,
            isText: node => node.type === 'JSXText',
            leaveInPlace: () => false,
            isExpression: node => node.type === 'JSXExpressionContainer',
            getTextContent: (node: JX.JSXText) => node.value,
            getCommentData: (node: JX.JSXExpressionContainer) =>
                this.getMarkupCommentBody(node.expression as JX.JSXEmptyExpression),
            canHaveChildren: node => nodesWithChildren.includes(node.type),
            visitFunc: (child, inCompoundText) => {
                const inCompoundTextPrev = this.inCompoundText
                this.inCompoundText = inCompoundText
                const childTxts = this.visitJx(child)
                this.inCompoundText = inCompoundTextPrev // restore
                return childTxts
            },
            visitExpressionTag: this.visitJSXExpressionContainer,
            fullHeuristicDetails: this.fullHeuristicDetails,
            checkHeuristic: this.getHeuristicMessageType,
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
                    const index = this.index.get(getKey(msgInfo.msgStr, msgInfo.context))
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

    visitChildrenJ = (node: JX.JSXElement | JX.JSXFragment): Message[] => {
        const prevInsideProg = this.heuristciDetails.insideProgram
        this.heuristciDetails.insideProgram = false
        const msg = this.mixedVisitor.visit({
            children: node.children,
            commentDirectives: this.commentDirectives,
            inCompoundText: this.inCompoundText,
            scope: 'markup',
            element: this.currentElement as string,
        })
        this.heuristciDetails.insideProgram = prevInsideProg // restore
        return msg
    }

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
            const key = node.openingElement.attributes.find(
                attr => attr.type === 'JSXAttribute' && attr.name.name === 'key',
            )
            if (!key) {
                this.mstr.appendLeft(node.openingElement.name.end, ` key="_${this.currentJsxKey}"`)
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
            node.start + startWh,
            node.end - endWh,
            `{${this.vars().rtTrans}(${this.index.get(getKey(msgInfo.msgStr, msgInfo.context))})}`,
        )
        return [msgInfo]
    }

    visitJSXFragment = (node: JX.JSXFragment): Message[] => this.visitChildrenJ(node)

    getMarkupCommentBody = (node: JX.JSXEmptyExpression): string => {
        const comment = this.content.slice(node.start, node.end).trim()
        if (!comment) {
            return ''
        }
        return comment.slice(2, -2).trim()
    }

    visitJSXExpressionContainer = (node: JX.JSXExpressionContainer): Message[] =>
        this.visit(node.expression as Estree.Expression)

    visitJSXAttribute = (node: JX.JSXAttribute): Message[] => {
        if (node.value == null) {
            return []
        }
        let name: string
        if (node.name.type === 'JSXIdentifier') {
            name = node.name.name
        } else {
            name = node.name.name.name
        }
        const heurBase = {
            scope: 'script' as 'script',
            element: this.currentElement,
            attribute: name,
        }
        if (node.value.type !== 'Literal') {
            if (node.value.type === 'JSXExpressionContainer') {
                if (node.value.expression.type === 'Literal' && typeof node.value.expression.value === 'string') {
                    const expr = node.value.expression as Estree.Literal
                    return this.visitWithCommentDirectives(expr, () => this.visitLiteral(expr, heurBase))
                }
                if (node.value.expression.type === 'TemplateLiteral') {
                    const expr = node.value.expression as Estree.TemplateLiteral
                    return this.visitWithCommentDirectives(expr, () => this.visitTemplateLiteral(expr, heurBase))
                }
            }
            return this.visitJx(node.value)
        }
        if (typeof node.value.value !== 'string') {
            return []
        }
        const value = node.value
        const [pass, msgInfo] = this.checkHeuristic(node.value.value, heurBase)
        if (!pass) {
            return []
        }
        this.mstr.update(value.start, value.end, `{${this.literalRepl(msgInfo)}}`)
        return [msgInfo]
    }

    visitJSXSpreadAttribute = (node: JX.JSXSpreadAttribute): Message[] => this.visit(node.argument as Estree.Expression)

    visitJx = (node: JX.Node | JX.JSXSpreadChild | Estree.Program): Message[] => this.visit(node as Estree.AnyNode)

    transformJx = (lib: JSXLib): TransformOutput => {
        // jsx vs type casting is not ambiguous in all files except .ts files
        const [ast, comments] = (this.heuristciDetails.file.endsWith('.ts') ? parseScript : parseScriptJSX)(
            this.content,
        )
        this.comments = comments
        this.mstr = new MagicString(this.content)
        this.mixedVisitor = this.initMixedVisitor()
        if (lib === 'default') {
            this.currentJsxKey = 0
        }
        const msgs = this.visitJx(ast)
        const header = [
            `import ${rtComponent} from "@wuchale/jsx/runtime${lib === 'solidjs' ? '.solid' : ''}.jsx"`,
            this.initRuntime(),
        ].join('\n')
        const bodyStart = this.getRealBodyStart(ast.body) as number
        return this.finalize(msgs, bodyStart, header)
    }
}
