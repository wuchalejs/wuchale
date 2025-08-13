import MagicString from "magic-string"
import { Parser, type Program } from "acorn"
import { NestText } from 'wuchale'
import { tsPlugin } from '@sveltejs/acorn-typescript'
import type * as JX from 'estree-jsx'
import jsx from 'acorn-jsx'
import { Transformer, scriptParseOptionsWithComments } from 'wuchale/adapter-vanilla'
import type {
    IndexTracker,
    HeuristicFunc,
    TransformOutput,
    CommentDirectives,
    TransformHeader,
    RuntimeOptions,
} from 'wuchale'
import { nonWhitespaceText, MixedVisitor } from "wuchale/adapter-utils"

const JsxParser = Parser.extend(tsPlugin(), jsx())

export function parseScript(content: string): [Program, JX.Comment[][]] {
    const [opts, comments] = scriptParseOptionsWithComments()
    return [JsxParser.parse(content, opts), comments]
}

const nodesWithChildren = ['JSXElement']
const rtComponent = 'WuchaleTrans'

type MixedNodesTypes = JX.JSXElement | JX.JSXFragment | JX.JSXText | JX.JSXExpressionContainer | JX.JSXSpreadChild

export class JSXTransformer extends Transformer {

    // state
    currentElement?: string
    inCompoundText: boolean = false
    commentDirectivesStack: CommentDirectives[] = []
    lastVisitIsComment: boolean = false
    currentElementI = 0

    mixedVisitor: MixedVisitor<MixedNodesTypes>

    constructor(content: string, filename: string, index: IndexTracker, heuristic: HeuristicFunc, pluralsFunc: string, runtimeOpts: RuntimeOptions, initRuntimeExpr: string | null) {
        super(content, filename, index, heuristic, pluralsFunc, runtimeOpts, initRuntimeExpr)
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
        checkHeuristic: txt => this.checkHeuristic(txt, { scope: 'markup', element: this.currentElement })[0],
        index: this.index,
        wrapNested: (txt, hasExprs, nestedRanges, lastChildEnd) => {
            for (const [i, [childStart, _, haveCtx]] of nestedRanges.entries()) {
                let toAppend: string
                if (i === 0) {
                    toAppend = `<${rtComponent} tags={[`
                } else {
                    toAppend = ', '
                }
                this.mstr.appendRight(childStart, `${toAppend}${haveCtx ? this.vars.nestCtx : '()'} => `)
            }
            let begin = `]} ctx=`
            if (this.inCompoundText) {
                begin += `{${this.vars.nestCtx}} nest`
            } else {
                const index = this.index.get(txt.toKey())
                begin += `{${this.vars.rtCtx}(${index})}`
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

    visitChildrenJ = (node: JX.JSXElement | JX.JSXFragment): NestText[] => this.mixedVisitor.visit({
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

    visitJSXElement = (node: JX.JSXElement): NestText[] => {
        const currentElement = this.currentElement
        this.currentElement = this.visitName(node.openingElement.name)
        const txts = this.visitChildrenJ(node)
        for (const attr of node.openingElement.attributes) {
            txts.push(...this.visitJx(attr))
        }
        if (this.inCompoundText) {
            this.mstr.appendLeft(
                // @ts-expect-error
                node.openingElement.name.end,
                ` key="_${this.currentElementI}"`
            )
        }
        this.currentElement = currentElement
        return txts
    }

    visitJSXText = (node: JX.JSXText): NestText[] => {
        const [startWh, trimmed, endWh] = nonWhitespaceText(node.value)
        const [pass, txt] = this.checkHeuristic(trimmed, {
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
            `{${this.vars.rtTrans}(${this.index.get(txt.toKey())})}`,
        )
        return [txt]
    }

    visitJSXFragment = (node: JX.JSXFragment): NestText[] => this.visitChildrenJ(node)

    getMarkupCommentBody = (node: JX.JSXEmptyExpression): string => {
        // @ts-expect-error
        const comment = this.content.slice(node.start, node.end).trim()
        if (!comment) {
            return ''
        }
        return comment.slice(2, -2).trim()
    }

    visitJSXExpressionContainer = (node: JX.JSXExpressionContainer): NestText[] => {
        return this.visit(node.expression as JX.Expression)
    }

    visitJSXAttribute = (node: JX.JSXAttribute): NestText[] => {
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
        const [pass, txt] = this.checkHeuristic(node.value.value, {
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
            `{${this.vars.rtTrans}(${this.index.get(txt.toKey())})}`,
        )
        return [txt]
    }

    visitJSXSpreadAttribute = (node: JX.JSXSpreadAttribute): NestText[] => this.visit(node.argument)

    visitJSXEmptyExpression = (node: JX.JSXEmptyExpression): NestText[] => {
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

    visitJx = (node: JX.Node | JX.JSXSpreadChild | Program): NestText[] => {
        if (node.type === 'JSXText' && !node.value.trim()) {
            return []
        }
        if (node.type === 'JSXExpressionContainer' && node.expression.type === 'JSXEmptyExpression') { // markup comment
            return this.visitJSXEmptyExpression(node.expression)
        }
        let txts = []
        const commentDirectivesPrev = this.commentDirectives
        if (this.lastVisitIsComment) {
            this.commentDirectives = this.commentDirectivesStack.pop()
            this.lastVisitIsComment = false
        }
        if (this.commentDirectives.forceInclude !== false) {
            txts = this.visit(node)
        }
        this.commentDirectives = commentDirectivesPrev
        return txts
    }

    transformJx = (header: TransformHeader, solidVariant: boolean): TransformOutput => {
        const [ast, comments] = parseScript(this.content)
        this.comments = comments
        this.mstr = new MagicString(this.content)
        this.mixedVisitor = this.initMixedVisitor()
        const txts = this.visitJx(ast)
        if (!txts.length) {
            return this.finalize(txts)
        }
        const headerFin = [
            `import ${rtComponent} from "@wuchale/jsx/runtime${solidVariant ? '.solid' : ''}.jsx"`,
            header.head,
            this.runtimeOpts.initInScope({ funcName: null, file: this.filename }) ? `const ${this.vars.rtConst} = ${header.expr}\n` : '',
        ].join('\n')
        this.mstr.appendRight(0, headerFin + '\n')
        return this.finalize(txts)
    }
}
