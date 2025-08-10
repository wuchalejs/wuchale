import MagicString from "magic-string"
import { Parser, type Program } from "acorn"
import { NestText } from 'wuchale/adapters'
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
} from 'wuchale/adapters'
import { nonWhitespaceText, varNames } from "wuchale/adapter-utils/utils.js"
import { visitMixedContent, type VisitForNested, type WrapNestedFunc } from "wuchale/adapter-utils/mixed-element.js"

const JsxParser = Parser.extend(tsPlugin(), jsx())

export function parseScript(content: string): [Program, JX.Comment[][]] {
    const [opts, comments] = scriptParseOptionsWithComments()
    return [JsxParser.parse(content, opts), comments]
}

const nodesWithChildren = ['JSXElement']
const rtComponent = 'WuchaleTrans'

type MixedNodesTypes = JX.JSXElement | JX.JSXFragment | JX.JSXText | JX.JSXExpressionContainer | JX.JSXSpreadChild

export class ReactTransformer extends Transformer {

    // state
    currentElement?: string
    inCompoundText: boolean = false
    commentDirectivesStack: CommentDirectives[] = []
    lastVisitIsComment: boolean = false
    currentElementI = 0

    constructor(content: string, filename: string, index: IndexTracker, heuristic: HeuristicFunc, pluralsFunc: string, initInsideFuncExpr: string | null) {
        super(content, filename, index, heuristic, pluralsFunc, initInsideFuncExpr)
    }

    visitChildrenJd = (node: JX.JSXElement | JX.JSXFragment): NestText[] => {
        const txt = []
        for (const child of node.children) {
            txt.push(...this.visitJx(child))
        }
        return txt
    }

    visitForNested: VisitForNested<MixedNodesTypes> = (child, inCompoundText) => {
        const inCompoundTextPrev = this.inCompoundText
        this.inCompoundText = inCompoundText
        const childTxts = this.visitJx(child)
        this.inCompoundText = inCompoundTextPrev // restore
        return childTxts
    }

    wrapNested: WrapNestedFunc = (txt, hasExprs, nestedRanges, lastChildEnd) => {
        for (const [i, [childStart, _, haveCtx]] of nestedRanges.entries()) {
            let toAppend: string
            if (i === 0) {
                toAppend = `<${rtComponent} tags={[`
            } else {
                toAppend = ', '
            }
            this.mstr.appendRight(childStart, `${toAppend}${haveCtx ? varNames.nestCtx: '()'} => `)
        }
        let begin = `]} ctx=`
        if (this.inCompoundText) {
            begin += `{${varNames.nestCtx}} nest`
        } else {
            const index = this.index.get(txt.toKey())
            begin += `{${varNames.rtCtx}(${index})}`
        }
        let end = ' />'
        if (hasExprs) {
            begin += ' args={['
            end = ']}' + end
        }
        this.mstr.appendLeft(lastChildEnd, begin)
        this.mstr.appendRight(lastChildEnd, end)
    }

    visitChildrenJ = (node: JX.JSXElement | JX.JSXFragment): NestText[] => visitMixedContent<MixedNodesTypes>({
        children: node.children,
        mstr: this.mstr,
        getRange: node => ({
            // @ts-expect-error
            start: node.start,
            // @ts-expect-error
            end: node.end
        }),
        isComment: child => child.type === 'JSXExpressionContainer'
            && child.expression.type === 'JSXEmptyExpression'
            // @ts-expect-error
            && child.expression.end > child.expression.start,
        isText: child => child.type === 'JSXText',
        isExpression: child => child.type === 'JSXExpressionContainer',
        getTextContent: (child: JX.JSXText) => child.value,
        getCommentData: (child: JX.JSXExpressionContainer) => this.content.slice(
            // @ts-expect-error
            child.expression.start,
            // @ts-expect-error
            child.expression.end,
        ),
        canHaveChildren: node => nodesWithChildren.includes(node.type),
        commentDirectives: this.commentDirectives,
        inCompoundText: this.inCompoundText,
        visit: this.visitForNested,
        visitExpressionTag: this.visitJSXExpressionContainer,
        checkHeuristic: txt => this.checkHeuristic(txt, { scope: 'markup', element: this.currentElement })[0],
        index: this.index,
        wrapNested: this.wrapNested,
    })

    visitNameJSXNamespacedName = (node: JX.JSXNamespacedName): string => {
        return `${this.visitName(node.namespace)}:${this.visitName(node.name)}`
    }

    visitNameJSXMemberExpression = (node: JX.JSXMemberExpression): string => {
        return `${this.visitName(node.object)}.${this.visitName(node.property)}`
    }

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
            `{${varNames.rtTrans}(${this.index.get(txt.toKey())})}`,
        )
        return [txt]
    }

    visitJSXFragment = (node: JX.JSXFragment): NestText[] => this.visitChildrenJ(node)

    visitJSXEmptyExpression = (node: JX.JSXEmptyExpression): NestText[] => {
        // @ts-expect-error
        const comment = this.content.slice(node.start, node.end).trim()
        if (!comment) {
            return
        }
        const commentContents = comment.slice(2, -2).trim()
        if (!commentContents) {
            return
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

    visitJSXExpressionContainer = (node: JX.JSXExpressionContainer): NestText[] => this.visitJx(node.expression)

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
            `{${varNames.rtTrans}(${this.index.get(txt.toKey())})}`,
        )
        return [txt]
    }

    visitJSXSpreadAttribute = (node: JX.JSXSpreadAttribute): NestText[] => this.visit(node.argument)

    visitJx = (node: JX.Node | JX.JSXSpreadChild | Program): NestText[] => {
        let txts = []
        const commentDirectivesPrev = this.commentDirectives
        if (this.lastVisitIsComment) {
            this.commentDirectives = this.commentDirectivesStack.pop()
        }
        if (this.commentDirectives.forceInclude !== false) {
            txts = this.visit(node)
        }
        this.commentDirectives = commentDirectivesPrev
        this.lastVisitIsComment = false
        return txts
    }

    transformJx = (header: TransformHeader): TransformOutput => {
        const [ast, comments] = parseScript(this.content)
        this.comments = comments
        this.mstr = new MagicString(this.content)
        const txts = this.visitJx(ast)
        if (!txts.length) {
            return this.finalize(txts)
        }
        const headerFin = [
            `import ${rtComponent} from "@wuchale/react/runtime.jsx"`,
            header.head,
            `const ${varNames.rtConst} = ${header.expr}\n`,
        ].join('\n')
        this.mstr.appendRight(0, headerFin + '\n')
        return this.finalize(txts)
    }
}
