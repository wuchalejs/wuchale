import MagicString from "magic-string"
import { Message } from "wuchale"
import type * as Estree from "acorn"
import { parseScript, Transformer } from "wuchale/adapter-vanilla"
import type {
    IndexTracker,
    HeuristicFunc,
    TransformOutput,
    RuntimeConf,
    CatalogExpr,
    CodePattern,
    UrlMatcher,
    HeuristicDetailsBase,
} from "wuchale"
import {
    nonWhitespaceText,
    MixedVisitor,
    processCommentDirectives,
    type CommentDirectives,
} from "wuchale/adapter-utils"
import { parse } from "@astrojs/compiler"
import type {
    ElementNode,
    TextNode,
    CommentNode,
    FragmentNode,
    Node,
    RootNode,
    ExpressionNode,
    AttributeNode,
    FrontmatterNode,
    ComponentNode,
    CustomElementNode,
} from "@astrojs/compiler/types"

// Astro nodes that can have children
const nodesWithChildren = [
    "element",
    "component",
    "custom-element",
    "fragment",
]

const rtRenderFunc = "_w_Tx_"

type MixedAstroNodes = Node

export class AstroTransformer extends Transformer {

    // state
    currentElement?: string
    inCompoundText: boolean = false
    commentDirectivesStack: CommentDirectives[] = []
    lastVisitIsComment: boolean = false
    frontMatterStart?: number

    mixedVisitor: MixedVisitor<MixedAstroNodes>

    // astro's compiler gives wrong offsets for expressions
    correctedExprRanges: WeakMap<Node, { start: number, end: number }> = new WeakMap()

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
        // trim() is VERY important, without it offset positions become wrong due to astro's parser
        super(content.trim(), filename, index, heuristic, patterns, catalogExpr, rtConf, matchUrl)
        this.heuristciDetails.insideProgram = false
    }

    _saveCorrectedExprRanges = (nodes: Node[], containerEnd: number) => {
        for (const [i, child] of nodes.entries()) {
            if (child.type !== 'expression') {
                continue
            }
            const nextChild = nodes[i + 1]
            let actualEnd: number
            if (nextChild != null) {
                actualEnd = nextChild.position?.start?.offset ?? 0
                if (nextChild.type === 'expression') {
                    actualEnd = this.content.indexOf('{', actualEnd)
                }
            } else {
                actualEnd = this.content.lastIndexOf('}', containerEnd) + 1
            }
            this.correctedExprRanges.set(child, {
                start: this.content.indexOf('{', child.position?.start?.offset ?? 0),
                end: actualEnd
            })
        }
    }

    getRange = (node: Node | AttributeNode) => {
        if (node.type === 'expression') {
            return this.correctedExprRanges.get(node) ?? { start: -1, end: -1 }
        }
        let { start, end } = node.position ?? {}
        return {
            start: start?.offset ?? -1,
            end: end?.offset ?? -1,
        }
    }

    initMixedVisitor = () => new MixedVisitor<MixedAstroNodes>({
        mstr: this.mstr,
        vars: this.vars,
        getRange: this.getRange,
        isText: node => node.type === 'text',
        isComment: node => node.type === 'comment',
        leaveInPlace: node => [''].includes(node.type),
        isExpression: node => node.type === 'expression',
        getTextContent: (node: TextNode) => node.value,
        getCommentData: (node: CommentNode) => node.value,
        canHaveChildren: (node) => nodesWithChildren.includes(node.type),
        visitFunc: (child, inCompoundText) => {
            const inCompoundTextPrev = this.inCompoundText
            this.inCompoundText = inCompoundText
            const childTxts = this.visitAs(child)
            this.inCompoundText = inCompoundTextPrev // restore
            return childTxts
        },
        visitExpressionTag: this.visitexpression,
        fullHeuristicDetails: this.fullHeuristicDetails,
        checkHeuristic: this.getHeuristicMessageType,
        index: this.index,
        wrapNested: (msgInfo, hasExprs, nestedRanges, lastChildEnd) => {
            let begin = `{${rtRenderFunc}({\nx: `
            if (this.inCompoundText) {
                begin += `${this.vars().nestCtx},\nn: true`
            } else {
                const index = this.index.get(msgInfo.toKey())
                begin += `${this.vars().rtCtx}(${index})`
            }
            if (nestedRanges.length > 0) {
                for (const [i, [childStart, _, haveCtx]] of nestedRanges.entries()) {
                    let toAppend: string
                    if (i === 0) {
                        toAppend = `${begin},\nt: [`
                    } else {
                        toAppend = ', '
                    }
                    this.mstr.appendRight(childStart, `${toAppend}${haveCtx ? this.vars().nestCtx : '()'} => `)
                }
                begin = `]`
            }
            let end = '\n})}'
            if (hasExprs) {
                begin += ',\na: ['
                end = ']' + end
            }
            this.mstr.appendLeft(lastChildEnd, begin)
            this.mstr.appendRight(lastChildEnd, end)
        },
    })

    _parseAndVisitExpr = (expr: string, startOffset: number, startFromProgram = false): Message[] => {
        const [ast, comments] = parseScript(expr)
        this.comments = comments
        this.mstr.offset = startOffset
        // not just visit Program because visitProgram sets insideProgram to true
        let msgs: Message[]
        if (startFromProgram) {
            msgs = this.visit(ast)
        } else {
            msgs = ast.body.map(this.visit).flat()
        }
        this.mstr.offset = 0 // restore
        return msgs
    }

    visitexpression = (node: ExpressionNode): Message[] => {
        let expr = ''
        const msgs: Message[] = []
        for (const part of node.children) {
            if (part.type === 'text') {
                expr += part.value
                continue
            }
            msgs.push(...this.visitAs(part))
            const {start, end} = this.getRange(part)
            expr += `"${' '.repeat(end - start)}"`
        }
        const {start} = this.getRange(node)
        msgs.push(...this._parseAndVisitExpr(expr, start + 1))
        return msgs
    }

    _visitChildren = (nodes: Node[]): Message[] => this.mixedVisitor.visit({
        children: nodes,
        commentDirectives: this.commentDirectives,
        inCompoundText: this.inCompoundText,
        scope: 'markup',
        element: this.currentElement as string,
        useComponent: this.currentElement !== 'title'
    })

    visitFragmentNode = (node: FragmentNode): Message[] => this._visitChildren(node.children)

    visitelement = (node: ElementNode): Message[] => {
        const currentElement = this.currentElement
        this.currentElement = node.name
        const msgs: Message[] = []
        for (const attrib of node.attributes) {
            msgs.push(...this.visitAs(attrib))
        }
        this._saveCorrectedExprRanges(node.children, node.position?.end?.offset ?? 0)
        msgs.push(...this._visitChildren(node.children))
        this.currentElement = currentElement
        return msgs
    }

    visitcomponent = (node: ComponentNode): Message[] => this.visitelement(node as unknown as ElementNode);

    ['visitcustom-element'] = (node: CustomElementNode): Message[] => this.visitelement(node as unknown as ElementNode)

    visitattribute = (node: AttributeNode): Message[] => {
        const heurBase: HeuristicDetailsBase = {
            scope: 'attribute',
            element: this.currentElement,
            attribute: node.name,
        }
        let {start} = this.getRange(node)
        if (node.kind !== 'empty') {
            start = this.content.indexOf('=', start) + 1
        }
        if (node.kind === 'quoted') {
            const [pass, msgInfo] = this.checkHeuristic(node.value, heurBase)
            if (!pass) {
                return []
            }
            this.mstr.update(
                start,
                start + node.value.length + 2,
                `{${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`,
            )
            return [msgInfo]
        }
        if (node.kind === 'expression') {
            heurBase.scope = 'script'
            start = this.content.indexOf(node.value, start)
            let expr = node.value
            if (expr.startsWith('...')) {
                start += 3
                expr = expr.slice(3)
            }
            return this._parseAndVisitExpr(expr, start)
        }
        return []
    }

    visittext = (node: TextNode): Message[] => {
        const [startWh, trimmed, endWh] = nonWhitespaceText(node.value)
        const [pass, msgInfo] = this.checkHeuristic(trimmed, {
            scope: 'markup',
            element: this.currentElement,
        })
        if (!pass) {
            return []
        }
        const { start, end } = this.getRange(node)
        this.mstr.update(start + startWh, end - endWh, `{${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`)
        return [msgInfo]
    }

    visitfrontmatter = (node: FrontmatterNode): Message[] => {
        const { start } = this.getRange(node)
        this.frontMatterStart = this.content.indexOf('---', start) + 3
        return this._parseAndVisitExpr(node.value, this.frontMatterStart, true)
    }

    visitroot = (node: RootNode): Message[] => {
        const msgs: Message[] = []
        for (const rootChild of node.children) {
            msgs.push(...this.visitAs(rootChild))
        }
        return msgs
    }

    visitAs = (node: Node | AttributeNode | Estree.AnyNode): Message[] => {
        if (node.type === 'comment') {
            this.commentDirectives = processCommentDirectives(node.value.trim(), this.commentDirectives)
            if (this.lastVisitIsComment) {
                this.commentDirectivesStack[this.commentDirectivesStack.length - 1] = this.commentDirectives
            } else {
                this.commentDirectivesStack.push(this.commentDirectives)
            }
            this.lastVisitIsComment = true
            return []
        }
        if (node.type === 'text' && !node.value.trim()) {
            return []
        }
        let msgs: Message[] = []
        const commentDirectivesPrev = this.commentDirectives
        if (this.lastVisitIsComment) {
            this.commentDirectives = this.commentDirectivesStack.pop() as CommentDirectives
            this.lastVisitIsComment = false
        }
        if (this.commentDirectives.ignoreFile) {
            return []
        }
        if (this.commentDirectives.forceType !== false) {
            msgs = this.visit(node as Estree.AnyNode)
        }
        this.commentDirectives = commentDirectivesPrev
        return msgs
    }

    transformAs = async (): Promise<TransformOutput> => {
        const { ast } = await parse(this.content)
        this.mstr = new MagicString(this.content)
        this.mixedVisitor = this.initMixedVisitor()
        const msgs = this.visitAs(ast)
        if (this.frontMatterStart == null) {
            this.mstr.appendLeft(0, '---\n')
            this.mstr.appendRight(0, '---\n')
        }
        const header = [
            `import ${rtRenderFunc} from "@wuchale/astro/runtime.js"`,
            this.initRuntime(),
        ].join('\n')
        return this.finalize(msgs, this.frontMatterStart ?? 0, header)
    }
}
