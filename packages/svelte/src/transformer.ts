import MagicString from "magic-string"
import type { Program, AnyNode } from "acorn"
import { parse, type AST } from "svelte/compiler"
import { NestText } from 'wuchale/adapters'
import { Transformer, parseScript } from 'wuchale/adapter-vanilla'
import type {
    IndexTracker,
    HeuristicFunc,
    TransformOutput,
    CommentDirectives,
    TransformHeader
} from 'wuchale/adapters'
import { visitMixedContent, type VisitForNested, type WrapNestedFunc } from "wuchale/adapter-utils/mixed-element.js"
import { nonWhitespaceText, varNames } from "wuchale/adapter-utils/utils.js"

const nodesWithChildren = ['RegularElement', 'Component']

const rtComponent = 'WuchaleTrans'
const snipPrefix = 'wuchaleSnippet'

type MixedNodesTypes = AST.Text | AST.Tag | AST.ElementLike | AST.Block | AST.Comment

export class SvelteTransformer extends Transformer {

    // state
    currentElement?: string
    inCompoundText: boolean = false
    commentDirectivesStack: CommentDirectives[] = []
    lastVisitIsComment: boolean = false
    currentSnippet: number = 0

    constructor(content: string, filename: string, index: IndexTracker, heuristic: HeuristicFunc, pluralsFunc: string, initInsideFuncExpr: string | null) {
        super(content, filename, index, heuristic, pluralsFunc, initInsideFuncExpr)
    }

    visitExpressionTag = (node: AST.ExpressionTag): NestText[] => this.visit(node.expression)

    wrapNested: WrapNestedFunc = (txt, hasExprs, nestedRanges, lastChildEnd) => {
        const snippets = []
        // create and reference snippets
        for (const [childStart, childEnd, haveCtx] of nestedRanges) {
            const snippetName = `${snipPrefix}${this.currentSnippet}`
            snippets.push(snippetName)
            this.currentSnippet++
            const snippetBegin = `\n{#snippet ${snippetName}(${haveCtx ? varNames.nestCtx : ''})}\n`
            this.mstr.appendRight(childStart, snippetBegin)
            this.mstr.prependLeft(childEnd, '\n{/snippet}')
        }
        let begin = `\n<${rtComponent} tags={[${snippets.join(', ')}]} ctx=`
        if (this.inCompoundText) {
            begin += `{${varNames.nestCtx}} nest`
        } else {
            const index = this.index.get(txt.toKey())
            begin += `{${varNames.rtCtx}(${index})}`
        }
        let end = ' />\n'
        if (hasExprs) {
            begin += ' args={['
            end = ']}' + end
        }
        this.mstr.appendLeft(lastChildEnd, begin)
        this.mstr.appendRight(lastChildEnd, end)
    }

    visitForNested: VisitForNested<MixedNodesTypes> = (child, inCompoundText) => {
        const inCompoundTextPrev = this.inCompoundText
        this.inCompoundText = inCompoundText
        const childTxts = this.visitSv(child)
        this.inCompoundText = inCompoundTextPrev // restore
        return childTxts
    }

    visitFragment = (node: AST.Fragment): NestText[] => visitMixedContent<MixedNodesTypes>({
        children: node.nodes,
        mstr: this.mstr,
        getRange: node => ({ start: node.start, end: node.end }),
        isText: child => child.type === 'Text',
        isComment: child => child.type === 'Comment',
        isExpression: child => child.type === 'ExpressionTag',
        getTextContent: (child: AST.Text) => child.data,
        getCommentData: (child: AST.Comment) => child.data,
        canHaveChildren: (child: AST.BaseNode) => nodesWithChildren.includes(child.type),
        commentDirectives: this.commentDirectives,
        inCompoundText: this.inCompoundText,
        visit: this.visitForNested,
        visitExpressionTag: this.visitExpressionTag,
        checkHeuristic: txt => this.checkHeuristic(txt, { scope: 'markup', element: this.currentElement })[0],
        index: this.index,
        wrapNested: this.wrapNested,
    })

    visitRegularElement = (node: AST.ElementLike): NestText[] => {
        const currentElement = this.currentElement
        this.currentElement = node.name
        const txts: NestText[] = []
        for (const attrib of node.attributes) {
            txts.push(...this.visitSv(attrib))
        }
        txts.push(...this.visitFragment(node.fragment))
        this.currentElement = currentElement
        return txts
    }

    visitComponent = this.visitRegularElement

    visitText = (node: AST.Text): NestText[] => {
        const [startWh, trimmed, endWh] = nonWhitespaceText(node.data)
        const [pass, txt] = this.checkHeuristic(trimmed, {
            scope: 'markup',
            element: this.currentElement,
        })
        if (!pass) {
            return []
        }
        this.mstr.update(node.start + startWh, node.end - endWh, `{${varNames.rtTrans}(${this.index.get(txt.toKey())})}`)
        return [txt]
    }

    visitSpreadAttribute = (node: AST.SpreadAttribute): NestText[] => this.visit(node.expression)

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
                txts.push(...this.visitSv(value))
                continue
            }
            // Text
            const { start, end } = value
            const [pass, txt] = this.checkHeuristic(value.data, {
                scope: 'attribute',
                element: this.currentElement,
                attribute: node.name,
            })
            if (!pass) {
                continue
            }
            txts.push(txt)
            this.mstr.update(value.start, value.end, `{${varNames.rtTrans}(${this.index.get(txt.toKey())})}`)
            if (!`'"`.includes(this.content[start - 1])) {
                continue
            }
            this.mstr.remove(start - 1, start)
            this.mstr.remove(end, end + 1)
        }
        return txts
    }

    visitSnippetBlock = (node: AST.SnippetBlock): NestText[] => this.visitFragment(node.body)

    visitIfBlock = (node: AST.IfBlock): NestText[] => {
        const txts = this.visit(node.test)
        txts.push(...this.visitSv(node.consequent))
        if (node.alternate) {
            txts.push(...this.visitSv(node.alternate))
        }
        return txts
    }

    visitEachBlock = (node: AST.EachBlock): NestText[] => {
        const txts = [
            ...this.visit(node.expression),
            ...this.visitSv(node.body),
        ]
        if (node.key) {
            txts.push(...this.visit(node.key))
        }
        if (node.fallback) {
            txts.push(...this.visitSv(node.fallback))
        }
        return txts
    }

    visitKeyBlock = (node: AST.KeyBlock): NestText[] => {
        return [
            ...this.visit(node.expression),
            ...this.visitSv(node.fragment),
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

    visitSvelteBody = (node: AST.SvelteBody): NestText[] => node.attributes.map(this.visitSv).flat()

    visitSvelteDocument = (node: AST.SvelteDocument): NestText[] => node.attributes.map(this.visitSv).flat()

    visitSvelteElement = (node: AST.SvelteElement): NestText[] => node.attributes.map(this.visitSv).flat()

    visitSvelteBoundary = (node: AST.SvelteBoundary): NestText[] => [
        ...node.attributes.map(this.visitSv).flat(),
        ...this.visitSv(node.fragment),
    ]

    visitSvelteHead = (node: AST.SvelteHead): NestText[] => this.visitSv(node.fragment)

    visitSvelteWindow = (node: AST.SvelteWindow): NestText[] => node.attributes.map(this.visitSv).flat()

    visitRoot = (node: AST.Root): NestText[] => {
        const txts = this.visitFragment(node.fragment)
        if (node.instance) {
            this.commentDirectives = {} // reset
            txts.push(...this.visitProgram(node.instance.content))
        }
        // @ts-ignore: module is a reserved keyword, not sure how to specify the type
        if (node.module) {
            this.commentDirectives = {} // reset
            // @ts-ignore
            txts.push(...this.visitProgram(node.module.content))
        }
        return txts
    }

    visitSv = (node: AST.SvelteNode | AnyNode): NestText[] => {
        if (node.type === 'Comment') {
            const directives = this.processCommentDirectives(node.data.trim())
            if (this.lastVisitIsComment) {
                this.commentDirectivesStack[this.commentDirectivesStack.length - 1] = directives
            } else {
                this.commentDirectivesStack.push(directives)
            }
            this.lastVisitIsComment = true
            return []
        }
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

    transformSv = (header: TransformHeader): TransformOutput => {
        const isComponent = this.filename.endsWith('.svelte')
        let ast: AST.Root | Program
        if (isComponent) {
            ast = parse(this.content, { modern: true })
        } else {
            const [pAst, comments] = parseScript(this.content)
            ast = pAst
            this.comments = comments
        }
        this.mstr = new MagicString(this.content)
        const txts = this.visitSv(ast)
        if (!txts.length) {
            return this.finalize(txts)
        }
        const headerFin = [
            `\nimport ${rtComponent} from "@wuchale/svelte/runtime.svelte"`,
            header.head,
            `const ${varNames.rtConst} = $derived(${header.expr})\n`,
        ].join('\n')
        if (ast.type === 'Program') {
            this.mstr.appendRight(0, headerFin + '\n')
            return this.finalize(txts)
        }
        if (ast.module) {
            // @ts-ignore
            this.mstr.appendRight(ast.module.content.start, headerFin)
        } else if (ast.instance) {
            // @ts-ignore
            this.mstr.appendRight(ast.instance.content.start, headerFin)
        } else {
            this.mstr.prepend(`<script>${headerFin}</script>\n`)
        }
        return this.finalize(txts)
    }
}
