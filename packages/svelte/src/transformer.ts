import MagicString from "magic-string"
import type { Program, AnyNode } from "acorn"
import { parse, type AST } from "svelte/compiler"
import { Message } from 'wuchale'
import { Transformer, parseScript } from 'wuchale/adapter-vanilla'
import type {
    IndexTracker,
    HeuristicFunc,
    TransformOutput,
    CommentDirectives,
} from 'wuchale'
import { MixedVisitor, nonWhitespaceText, runtimeVars } from "wuchale/adapter-utils"

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

    mixedVisitor: MixedVisitor<MixedNodesTypes>

    constructor(content: string, filename: string, index: IndexTracker, heuristic: HeuristicFunc, pluralsFunc: string) {
        super(content, filename, index, heuristic, pluralsFunc, null)
    }

    visitExpressionTag = (node: AST.ExpressionTag): Message[] => this.visit(node.expression)

    initMixedVisitor = () => new MixedVisitor<MixedNodesTypes>({
        mstr: this.mstr,
        getRange: node => ({ start: node.start, end: node.end }),
        isText: node => node.type === 'Text',
        isComment: node => node.type === 'Comment',
        isExpression: node => node.type === 'ExpressionTag',
        getTextContent: (node: AST.Text) => node.data,
        getCommentData: (node: AST.Comment) => node.data,
        canHaveChildren: (node: AST.BaseNode) => nodesWithChildren.includes(node.type),
        visitFunc: (child, inCompoundText) => {
            const inCompoundTextPrev = this.inCompoundText
            this.inCompoundText = inCompoundText
            const childTxts = this.visitSv(child)
            this.inCompoundText = inCompoundTextPrev // restore
            return childTxts
        },
        visitExpressionTag: this.visitExpressionTag,
        checkHeuristic: msgStr => this.checkHeuristic(msgStr, { scope: 'markup', element: this.currentElement })[0],
        index: this.index,
        wrapNested: (msgInfo, hasExprs, nestedRanges, lastChildEnd) => {
            const snippets = []
            // create and reference snippets
            for (const [childStart, childEnd, haveCtx] of nestedRanges) {
                const snippetName = `${snipPrefix}${this.currentSnippet}`
                snippets.push(snippetName)
                this.currentSnippet++
                const snippetBegin = `\n{#snippet ${snippetName}(${haveCtx ? runtimeVars.nestCtx : ''})}\n`
                this.mstr.appendRight(childStart, snippetBegin)
                this.mstr.prependLeft(childEnd, '\n{/snippet}')
            }
            let begin = `\n<${rtComponent} tags={[${snippets.join(', ')}]} ctx=`
            if (this.inCompoundText) {
                begin += `{${runtimeVars.nestCtx}} nest`
            } else {
                const index = this.index.get(msgInfo.toKey())
                begin += `{${runtimeVars.rtCtx}(${index})}`
            }
            let end = ' />\n'
            if (hasExprs) {
                begin += ' args={['
                end = ']}' + end
            }
            this.mstr.appendLeft(lastChildEnd, begin)
            this.mstr.appendRight(lastChildEnd, end)
        },
    })


    visitFragment = (node: AST.Fragment): Message[] => this.mixedVisitor.visit({
        children: node.nodes,
        commentDirectives: this.commentDirectives,
        inCompoundText: this.inCompoundText,
    })

    visitRegularElement = (node: AST.ElementLike): Message[] => {
        const currentElement = this.currentElement
        this.currentElement = node.name
        const msgs: Message[] = []
        for (const attrib of node.attributes) {
            msgs.push(...this.visitSv(attrib))
        }
        msgs.push(...this.visitFragment(node.fragment))
        this.currentElement = currentElement
        return msgs
    }

    visitComponent = this.visitRegularElement

    visitText = (node: AST.Text): Message[] => {
        const [startWh, trimmed, endWh] = nonWhitespaceText(node.data)
        const [pass, msgInfo] = this.checkHeuristic(trimmed, {
            scope: 'markup',
            element: this.currentElement,
        })
        if (!pass) {
            return []
        }
        this.mstr.update(node.start + startWh, node.end - endWh, `{${runtimeVars.rtTrans}(${this.index.get(msgInfo.toKey())})}`)
        return [msgInfo]
    }

    visitSpreadAttribute = (node: AST.SpreadAttribute): Message[] => this.visit(node.expression)

    visitAttribute = (node: AST.Attribute): Message[] => {
        if (node.value === true) {
            return []
        }
        const msgs = []
        let values: (AST.ExpressionTag | AST.Text)[]
        if (Array.isArray(node.value)) {
            values = node.value
        } else {
            values = [node.value]
        }
        for (const value of values) {
            if (value.type !== 'Text') { // ExpressionTag
                msgs.push(...this.visitSv(value))
                continue
            }
            // Text
            const { start, end } = value
            const [pass, msgInfo] = this.checkHeuristic(value.data, {
                scope: 'attribute',
                element: this.currentElement,
                attribute: node.name,
            })
            if (!pass) {
                continue
            }
            msgs.push(msgInfo)
            this.mstr.update(value.start, value.end, `{${runtimeVars.rtTrans}(${this.index.get(msgInfo.toKey())})}`)
            if (!`'"`.includes(this.content[start - 1])) {
                continue
            }
            this.mstr.remove(start - 1, start)
            this.mstr.remove(end, end + 1)
        }
        return msgs
    }

    visitSnippetBlock = (node: AST.SnippetBlock): Message[] => this.visitFragment(node.body)

    visitIfBlock = (node: AST.IfBlock): Message[] => {
        const msgs = this.visit(node.test)
        msgs.push(...this.visitSv(node.consequent))
        if (node.alternate) {
            msgs.push(...this.visitSv(node.alternate))
        }
        return msgs
    }

    visitEachBlock = (node: AST.EachBlock): Message[] => {
        const msgs = [
            ...this.visit(node.expression),
            ...this.visitSv(node.body),
        ]
        if (node.key) {
            msgs.push(...this.visit(node.key))
        }
        if (node.fallback) {
            msgs.push(...this.visitSv(node.fallback))
        }
        return msgs
    }

    visitKeyBlock = (node: AST.KeyBlock): Message[] => {
        return [
            ...this.visit(node.expression),
            ...this.visitSv(node.fragment),
        ]
    }

    visitAwaitBlock = (node: AST.AwaitBlock): Message[] => {
        const msgs = [
            ...this.visit(node.expression),
            ...this.visitFragment(node.then),
        ]
        if (node.pending) {
            msgs.push(...this.visitFragment(node.pending),)
        }
        if (node.catch) {
            msgs.push(...this.visitFragment(node.catch),)
        }
        return msgs
    }

    visitSvelteBody = (node: AST.SvelteBody): Message[] => node.attributes.map(this.visitSv).flat()

    visitSvelteDocument = (node: AST.SvelteDocument): Message[] => node.attributes.map(this.visitSv).flat()

    visitSvelteElement = (node: AST.SvelteElement): Message[] => node.attributes.map(this.visitSv).flat()

    visitSvelteBoundary = (node: AST.SvelteBoundary): Message[] => [
        ...node.attributes.map(this.visitSv).flat(),
        ...this.visitSv(node.fragment),
    ]

    visitSvelteHead = (node: AST.SvelteHead): Message[] => this.visitSv(node.fragment)

    visitSvelteWindow = (node: AST.SvelteWindow): Message[] => node.attributes.map(this.visitSv).flat()

    visitRoot = (node: AST.Root): Message[] => {
        const msgs = this.visitFragment(node.fragment)
        if (node.instance) {
            this.commentDirectives = {} // reset
            msgs.push(...this.visitProgram(node.instance.content))
        }
        // @ts-ignore: module is a reserved keyword, not sure how to specify the type
        if (node.module) {
            this.commentDirectives = {} // reset
            // @ts-ignore
            msgs.push(...this.visitProgram(node.module.content))
        }
        return msgs
    }

    visitSv = (node: AST.SvelteNode | AnyNode): Message[] => {
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
        if (node.type === 'Text' && !node.data.trim()) {
            return []
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

    transformSv = (headerHead: string, headerExpr: string): TransformOutput => {
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
        this.mixedVisitor = this.initMixedVisitor()
        const msgs = this.visitSv(ast)
        if (!msgs.length) {
            return this.finalize(msgs)
        }
        const headerFin = [
            `\nimport ${rtComponent} from "@wuchale/svelte/runtime.svelte"`,
            headerHead,
            `const ${runtimeVars.rtConst} = $derived(${runtimeVars.rtWrap}(${headerExpr}))\n`,
        ].join('\n')
        if (ast.type === 'Program') {
            this.mstr.appendRight(0, headerFin + '\n')
            return this.finalize(msgs)
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
        return this.finalize(msgs)
    }
}
