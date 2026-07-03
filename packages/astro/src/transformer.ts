import { parse } from '@astrojs/compiler'
import type {
    AttributeNode,
    CommentNode,
    ComponentNode,
    CustomElementNode,
    ElementNode,
    ExpressionNode,
    FragmentNode,
    FrontmatterNode,
    Node,
    RootNode,
    TextNode,
} from '@astrojs/compiler/types'
import { tsPlugin } from '@sveltejs/acorn-typescript'
import type * as Estree from 'acorn'
import { Parser } from 'acorn'
import type {
    CodePattern,
    HeuristicDetailsBase,
    HeuristicFunc,
    Message,
    RuntimeConf,
    TransformCtx,
    TransformOutput,
} from 'wuchale'
import { getKey } from 'wuchale'
import { MixedVisitor } from 'wuchale/adapter-utils'
import { parseScript, scriptParseOptionsWithComments, Transformer } from 'wuchale/adapter-vanilla'

const ExprParser = Parser.extend(tsPlugin())

export function parseExpr(content: string): [Estree.Expression, Estree.Comment[][]] {
    const [opts, comments] = scriptParseOptionsWithComments()
    return [ExprParser.parseExpressionAt(content, 0, opts), comments]
}

const rtRenderFunc = '_w_Tx_'

const u8decoder = new TextDecoder()

type MixedVisitorAstro = MixedVisitor<Node, TextNode, CommentNode, ExpressionNode>

export class AstroTransformer extends Transformer {
    byteArray: Uint8Array
    // state
    currentElement?: string | undefined
    frontMatterStart?: number

    mixedVisitor: MixedVisitorAstro

    // astro's compiler gives wrong offsets for expressions
    correctedExprRanges: WeakMap<Node | AttributeNode, { start: number; end: number }> = new WeakMap()

    constructor(ctx: TransformCtx, heuristic: HeuristicFunc, patterns: CodePattern[], rtConf: RuntimeConf) {
        // trim() is VERY important, without it offset positions become wrong due to astro's parser
        ctx.content = ctx.content.trim()
        super(ctx, heuristic, patterns, rtConf)
        this.byteArray = new Uint8Array(Buffer.from(this.content))
        this.heuristciDetails.insideProgram = false
        this.mixedVisitor = this.initMixedVisitor()
    }

    _byteOffsetToIndex(offset?: number) {
        // this is necessary because offsets come from astro's go parser, which works with bytes
        // and that can cause misalignments when there are unicode characters
        if (offset === undefined) {
            return -1
        }
        return u8decoder.decode(this.byteArray.slice(0, offset)).length
    }

    _saveCorrectedRanges(nodes: Node[], containerEnd: number) {
        for (const [i, child] of nodes.entries()) {
            if (child.type !== 'expression') {
                continue
            }
            let start = this._byteOffsetToIndex(child.position?.start?.offset)
            start = this.content.indexOf('{', start)
            const nextChild = nodes[i + 1]
            let end: number = this._byteOffsetToIndex(child.position?.end?.offset)
            if (nextChild != null) {
                end = this._byteOffsetToIndex(nextChild.position?.start?.offset)
                if (nextChild.type === 'expression') {
                    end = this.content.indexOf('{', end)
                }
            } else {
                end = this.content.lastIndexOf('}', containerEnd) + 1
            }
            this.correctedExprRanges.set(child, { start, end })
        }
    }

    getRange(node: Node | AttributeNode) {
        const corrected = this.correctedExprRanges.get(node)
        if (corrected) {
            return corrected
        }
        const { start, end } = node.position ?? {}
        return {
            start: this._byteOffsetToIndex(start?.offset),
            end: this._byteOffsetToIndex(end?.offset),
        }
    }

    initMixedVisitor(): MixedVisitorAstro {
        return new MixedVisitor({
            mstr: this.mstr,
            index: this.index,
            content: this.content,
            vars: this.vars.bind(this),
            getRange: this.getRange.bind(this),
            isText: node => node.type === 'text',
            isComment: node => node.type === 'comment',
            leaveInPlace: () => false,
            isExpression: node => node.type === 'expression',
            getTextContent: node => node.value,
            getCommentData: node => node.value.trim(),
            visitFunc: this.visitAs.bind(this),
            fullHeuristicDetails: this.fullHeuristicDetails.bind(this),
            checkHeuristic: this.getHeuristicMessageType.bind(this),
            wrapNested: (inNested, msgInfo, hasExprs, nestedRanges, lastChildEnd) => {
                const vars = this.vars()
                let begin = `{${rtRenderFunc}({\nx: `
                if (inNested) {
                    begin += `${vars.nestCtx},\nn: true`
                } else {
                    const index = this.index.get(getKey(msgInfo.msgStr, msgInfo.context))
                    begin += `${vars.rtCtx}(${index})`
                }
                if (nestedRanges.length > 0) {
                    for (const [i, [childStart, _, haveCtx]] of nestedRanges.entries()) {
                        let toAppend: string
                        if (i === 0) {
                            toAppend = `${begin},\nt: [`
                        } else {
                            toAppend = ', '
                        }
                        this.mstr.appendRight(childStart, `${toAppend}${haveCtx ? vars.nestCtx : '()'} => `)
                    }
                    begin = `]`
                }
                let end = '\n})}'
                if (hasExprs) {
                    begin += ',\na: ['
                    end = `]${end}`
                }
                this.mstr.appendLeft(lastChildEnd, begin)
                this.mstr.appendRight(lastChildEnd, end)
            },
        })
    }

    _parseAndVisitExpr(expr: string, startOffset: number, asScript = false): Message[] {
        const [ast, comments] = (asScript ? parseScript : parseExpr)(expr)
        this.comments = comments
        this.mstr.offset = startOffset
        const msgs = this.visit(ast)
        this.mstr.offset = 0 // restore
        return msgs
    }

    visitexpression(node: ExpressionNode): Message[] {
        if (!node.children?.length) {
            // can be undefined!
            return []
        }
        let expr = ''
        const msgs: Message[] = []
        const { start, end } = this.getRange(node)
        this._saveCorrectedRanges(node.children, end)
        for (const part of node.children) {
            if (part.type === 'text') {
                expr += part.value
                continue
            }
            msgs.push(...this.visitAs(part))
            const { start, end } = this.getRange(part)
            expr += `"${' '.repeat(end - start)}"`
        }
        msgs.push(...this._parseAndVisitExpr(expr, start + 1))
        return msgs
    }

    _visitChildren = (nodes: Node[], nestable: boolean): Message[] =>
        this.mixedVisitor.visit({
            children: nodes,
            nestable,
            commentDirectives: this.commentDirectives,
            scope: 'markup',
            element: this.currentElement as string,
            useComponent: this.currentElement !== 'title',
        })

    visitFragmentNode(node: FragmentNode): Message[] {
        return this._visitChildren(node.children, false)
    }

    visitelement(node: ElementNode): Message[] {
        const currentElement = this.currentElement
        this.currentElement = node.name
        const msgs: Message[] = []
        for (const attrib of node.attributes) {
            msgs.push(...this.visitAs(attrib))
        }
        const { end } = this.getRange(node)
        this._saveCorrectedRanges(node.children, end)
        msgs.push(...this._visitChildren(node.children, true))
        this.currentElement = currentElement
        return msgs
    }

    visitcomponent(node: ComponentNode): Message[] {
        return this.visitelement(node as unknown as ElementNode)
    }

    'visitcustom-element'(node: CustomElementNode): Message[] {
        return this.visitelement(node as unknown as ElementNode)
    }

    visitattribute(node: AttributeNode): Message[] {
        const heurBase: HeuristicDetailsBase = {
            scope: 'attribute',
            element: this.currentElement,
            attribute: node.name,
        }
        let { start } = this.getRange(node)
        if (node.kind === 'spread') {
            return this._parseAndVisitExpr(node.name, start)
        }
        if (node.kind !== 'empty') {
            start = this.content.indexOf('=', start) + 1
        }
        if (node.kind === 'quoted') {
            const [pass, msgInfo] = this.checkHeuristicAllowNew(node.value, heurBase)
            if (!pass) {
                return []
            }
            this.mstr.update(start, start + node.value.length + 2, `{${this.literalRepl(msgInfo)}}`)
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

    visitfrontmatter(node: FrontmatterNode): Message[] {
        const { start } = this.getRange(node)
        this.frontMatterStart = this.content.indexOf('---', start) + 3
        return this._parseAndVisitExpr(node.value, this.frontMatterStart, true)
    }

    visitroot(node: RootNode): Message[] {
        // node.children can be undefined!
        const children = node.children ?? []
        this._saveCorrectedRanges(children, this.content.length)
        const msgs = [...this._visitChildren(children, false)]
        return msgs
    }

    visitAs(node: Node | AttributeNode | Estree.AnyNode): Message[] {
        return this.visit(node as Estree.AnyNode)
    }

    async transformAs(): Promise<TransformOutput> {
        const { ast } = await parse(this.content)
        const msgs = this.visitAs(ast)
        if (this.frontMatterStart == null) {
            this.mstr.appendLeft(0, '---\n')
            this.mstr.appendRight(0, '---\n')
        }
        const header = [`import ${rtRenderFunc} from "@wuchale/astro/runtime.js"`, this.initRuntime()].join('\n')
        return this.finalize(msgs, this.frontMatterStart ?? 0, header)
    }
}
