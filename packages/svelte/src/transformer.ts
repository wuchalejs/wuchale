import MagicString from "magic-string"
import type { Program, AnyNode } from "acorn"
import { parse, type AST } from "svelte/compiler"
import { NestText } from 'wuchale/adapters'
import { Transformer, parseScript, runtimeConst } from 'wuchale/adapter-vanilla'
import type {
    IndexTracker,
    HeuristicFunc,
    TransformOutput,
    CommentDirectives,
    TransformHeader
} from 'wuchale/adapters'

const nodesWithChildren = ['RegularElement', 'Component']

const rtComponent = 'WuchaleTrans'
const snipPrefix = 'wuchaleSnippet'
const rtFuncCtx = `${runtimeConst}.cx`
const rtFuncCtxTrans = `${runtimeConst}.tx`

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

    nonWhitespaceText = (node: AST.Text): [number, string, number] => {
        let trimmedS = node.data.trimStart()
        const startWh = node.data.length - trimmedS.length
        let trimmed = trimmedS.trimEnd()
        const endWh = trimmedS.length - trimmed.length
        return [startWh, trimmed, endWh]
    }

    separatelyVisitChildren = (node: AST.Fragment): [boolean, boolean, boolean, NestText[]] => {
        let hasTextChild = false
        let hasNonTextChild = false
        let heurTxt = ''
        let hasCommentDirectives = false
        for (const child of node.nodes) {
            if (child.type === 'Text') {
                const txt = child.data.trim()
                if (!txt) {
                    continue
                }
                hasTextChild = true
                heurTxt += child.data + ' '
            } else if (child.type === 'Comment') {
                if (child.data.trim().startsWith('@wc-')) {
                    hasCommentDirectives = true
                }
            } else {
                hasNonTextChild = true
                heurTxt += `# `
            }
        }
        heurTxt = heurTxt.trimEnd()
        const [passHeuristic] = this.checkHeuristic(heurTxt, { scope: 'markup', element: this.currentElement })
        let hasCompoundText = hasTextChild && hasNonTextChild
        const visitAsOne = passHeuristic && !hasCommentDirectives
        if (this.inCompoundText || hasCompoundText && visitAsOne) {
            return [false, hasTextChild, hasCompoundText, []]
        }
        const txts = []
        // can't be extracted as one; visitSv each separately
        for (const child of node.nodes) {
            txts.push(...this.visitSv(child))
        }
        return [true, false, false, txts]
    }

    visitFragment = (node: AST.Fragment): NestText[] => {
        if (node.nodes.length === 0) {
            return []
        }
        const [visitedSeparately, hasTextChild, hasCompoundText, separateTxts] = this.separatelyVisitChildren(node)
        if (visitedSeparately) {
            return separateTxts
        }
        let txt = ''
        let iArg = 0
        let iTag = 0
        const lastChildEnd = node.nodes.slice(-1)[0].end
        const childrenForSnippets: [number, number, boolean][] = []
        let hasTextDescendants = false
        const txts = []
        for (const child of node.nodes) {
            if (child.type === 'Comment') {
                continue
            }
            if (child.type === 'Text') {
                const [startWh, trimmed, endWh] = this.nonWhitespaceText(child)
                const nTxt = new NestText(trimmed, 'markup', this.commentDirectives.context)
                if (startWh && !txt.endsWith(' ')) {
                    txt += ' '
                }
                if (!trimmed) { // whitespace
                    continue
                }
                txt += nTxt.text
                if (endWh) {
                    txt += ' '
                }
                this.mstr.remove(child.start, child.end)
                continue
            }
            if (child.type === 'ExpressionTag') {
                txts.push(...this.visitExpressionTag(child))
                if (!hasCompoundText) {
                    continue
                }
                txt += `{${iArg}}`
                let moveStart = child.start
                if (iArg > 0) {
                    this.mstr.update(child.start, child.start + 1, ', ')
                } else {
                    moveStart++
                    this.mstr.remove(child.start, child.start + 1)
                }
                this.mstr.move(moveStart, child.end - 1, lastChildEnd)
                this.mstr.remove(child.end - 1, child.end)
                iArg++
                continue
            }
            // elements, components and other things as well
            const nestedTextSupported = nodesWithChildren.includes(child.type)
            const inCompoundTextPrev = this.inCompoundText
            this.inCompoundText = nestedTextSupported
            const childTxts = this.visitSv(child)
            this.inCompoundText = inCompoundTextPrev // restore
            let snippNeedsCtx = false
            let chTxt = ''
            for (const txt of childTxts) {
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
            txt += chTxt
        }
        txt = txt.trim()
        if (!txt) {
            return txts
        }
        const nTxt = new NestText(txt, 'markup', this.commentDirectives.context)
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
            let begin = `\n<${rtComponent} tags={[${snippets.join(', ')}]} ctx=`
            if (this.inCompoundText) {
                begin += `{ctx} nest`
            } else {
                const index = this.index.get(nTxt.toKey())
                begin += `{${rtFuncCtx}(${index})}`
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
            if (this.inCompoundText) {
                begin += `${rtFuncCtxTrans}(ctx`
            } else {
                begin += `${this.rtFunc}(${this.index.get(nTxt.toKey())}`
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
        const [startWh, trimmed, endWh] = this.nonWhitespaceText(node)
        const [pass, txt] = this.checkHeuristic(trimmed, {
            scope: 'markup',
            element: this.currentElement,
        })
        if (!pass) {
            return []
        }
        this.mstr.update(node.start + startWh, node.end - endWh, `{${this.rtFunc}(${this.index.get(txt.toKey())})}`)
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
            this.mstr.update(value.start, value.end, `{${this.rtFunc}(${this.index.get(txt.toKey())})}`)
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
            ast = parseScript(this.content)
        }
        this.mstr = new MagicString(this.content)
        const txts = this.visitSv(ast)
        if (!txts.length) {
            return this.finalize(txts)
        }
        const headerFin = [
            `\nimport ${rtComponent} from "@wuchale/svelte/runtime.svelte"`,
            header.head,
            `const ${runtimeConst} = $derived(${header.expr})\n`,
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
