import MagicString from "magic-string"
import type { Program, AnyNode, VariableDeclarator, Identifier, Declaration, Literal, TemplateLiteral } from "acorn"
import { parse, preprocess, type AST, type Preprocessor } from "svelte/compiler"
import { Message } from 'wuchale'
import { Transformer, parseScript } from 'wuchale/adapter-vanilla'
import type {
    IndexTracker,
    HeuristicFunc,
    TransformOutput,
    CatalogExpr,
    RuntimeConf,
    CodePattern,
    HeuristicDetailsBase,
    UrlMatcher,
} from 'wuchale'
import { MixedVisitor, nonWhitespaceText, processCommentDirectives, varNames, type CommentDirectives } from "wuchale/adapter-utils"

const nodesWithChildren = ['RegularElement', 'Component']

const rtComponent = 'W_tx_'
const snipPrefix = '_w_snippet_'
const rtModuleVar = varNames.rt + 'mod_'

type MixedNodesTypes = AST.Text | AST.Tag | AST.ElementLike | AST.Block | AST.Comment

// for use before actually parsing the code,
// to remove the contents of e.g. <style lang="scss">
// without messing up indices for magic-string
const removeSCSS: Preprocessor = ({attributes, content}) => {
    if (attributes.lang) {
        return {
            code: ' '.repeat(content.length),
        }
    }
}

export type RuntimeCtxSv = {
    // inside of <script module> or not
    module: boolean
}

export class SvelteTransformer extends Transformer<RuntimeCtxSv> {

    // state
    currentElement?: string
    inCompoundText: boolean = false
    commentDirectivesStack: CommentDirectives[] = []
    lastVisitIsComment: boolean = false
    currentSnippet: number = 0
    moduleExportRanges: [number, number][] = [] // to choose which runtime var to use for snippets

    mixedVisitor: MixedVisitor<MixedNodesTypes>

    constructor(
        content: string,
        filename: string,
        index: IndexTracker,
        heuristic: HeuristicFunc,
        patterns: CodePattern[],
        catalogExpr: CatalogExpr,
        rtConf: RuntimeConf<RuntimeCtxSv>,
        matchUrl: UrlMatcher,
    ) {
        super(content, filename, index, heuristic, patterns, catalogExpr, rtConf, matchUrl, [varNames.rt, rtModuleVar])
        this.heuristciDetails.insideProgram = false
    }

    visitExpressionTag = (node: AST.ExpressionTag): Message[] => this.visit(node.expression as AnyNode)

    visitVariableDeclarator = (node: VariableDeclarator): Message[] => {
        const msgs = this.defaultVisitVariableDeclarator(node)
        const init = node.init
        if (!msgs.length || this.heuristciDetails.declaring != null || init == null || ['ArrowFunctionExpression', 'FunctionExpression'].includes(init.type)) {
            return msgs
        }
        const needsWrapping = msgs.some(msg => {
            if (msg.details.topLevelCall && ['$props', '$state', '$derived', '$derived.by'].includes(msg.details.topLevelCall)) {
                return false
            }
            if (msg.details.declaring !== 'variable') {
                return false
            }
            return true
        })
        if (!needsWrapping) {
			return msgs
        }
		const isExported = this.moduleExportRanges.some(([start, end]) => init.start >= start && init.end <= end)
		if (!isExported) {
			this.mstr.appendLeft(init.start, '$derived(')
			this.mstr.appendRight(init.end, ')')
		}
        return msgs
    }

    initMixedVisitor = () => new MixedVisitor<MixedNodesTypes>({
        mstr: this.mstr,
        vars: this.vars,
        getRange: node => ({ start: node.start, end: node.end }),
        isText: node => node.type === 'Text',
        isComment: node => node.type === 'Comment',
        leaveInPlace: node => ['ConstTag', 'SnippetBlock'].includes(node.type),
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
        fullHeuristicDetails: this.fullHeuristicDetails,
        checkHeuristic: this.getHeuristicMessageType,
        index: this.index,
        wrapNested: (msgInfo, hasExprs, nestedRanges, lastChildEnd) => {
            const snippets: string[] = []
            // create and reference snippets
            for (const [childStart, childEnd, haveCtx] of nestedRanges) {
                const snippetName = `${snipPrefix}${this.currentSnippet}`
                snippets.push(snippetName)
                this.currentSnippet++
                const snippetBegin = `\n{#snippet ${snippetName}(${haveCtx ? this.vars().nestCtx : ''})}\n`
                this.mstr.appendRight(childStart, snippetBegin)
                this.mstr.prependLeft(childEnd, '\n{/snippet}\n')
            }
            let begin = `\n<${rtComponent}`
            if (snippets.length) {
                begin += ` t={[${snippets.join(', ')}]}`
            }
            begin += ' x='
            if (this.inCompoundText) {
                begin += `{${this.vars().nestCtx}} n`
            } else {
                const index = this.index.get(msgInfo.toKey())
                begin += `{${this.vars().rtCtx}(${index})}`
            }
            let end = ' />\n'
            if (hasExprs) {
                begin += ' a={['
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
        scope: 'markup',
        element: this.currentElement as string,
        useComponent: this.currentElement !== 'title'
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
        this.mstr.update(node.start + startWh, node.end - endWh, `{${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`)
        return [msgInfo]
    }

    visitSpreadAttribute = (node: AST.SpreadAttribute): Message[] => this.visit(node.expression as AnyNode)

    visitAttribute = (node: AST.Attribute): Message[] => {
        if (node.value === true) {
            return []
        }
        let values: (AST.ExpressionTag | AST.Text)[]
        if (Array.isArray(node.value)) {
            values = node.value
        } else {
            values = [node.value]
        }
        if (values.length > 1) {
            return this.mixedVisitor.visit({
                children: values,
                commentDirectives: this.commentDirectives,
                inCompoundText: false,
                scope: 'attribute',
                element: this.currentElement as string,
                attribute: node.name,
            })
        }
        const value = values[0]
        const heuDetails: HeuristicDetailsBase = {
            scope: 'script',
            element: this.currentElement,
            attribute: node.name,
        }
        if (value.type === 'ExpressionTag') {
            if (value.expression.type === 'Literal') {
                const expr = value.expression as Literal
                return this.visitWithCommentDirectives(expr, () => this.visitLiteral(expr, heuDetails))
            }
            if (value.expression.type === 'TemplateLiteral') {
                const expr = value.expression as TemplateLiteral
                return this.visitWithCommentDirectives(expr, () => this.visitTemplateLiteral(expr, heuDetails))
            }
            return this.visitSv(value)
        }
        heuDetails.scope = 'attribute'
        const [pass, msgInfo] = this.checkHeuristic(value.data, heuDetails)
        if (!pass) {
            return []
        }
        this.mstr.update(value.start, value.end, `{${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`)
        if (`'"`.includes(this.content[value.start - 1])) {
            this.mstr.remove(value.start - 1, value.start)
            this.mstr.remove(value.end, value.end + 1)
        }
        return [msgInfo]
    }

    visitConstTag = (node: AST.ConstTag): Message[] => {
        // @ts-expect-error
        return this.visitVariableDeclaration(node.declaration)
    }

    visitRenderTag = (node: AST.RenderTag): Message[] => {
        // @ts-expect-error
        return this.visit(node.expression)
    }

    visitSnippetBlock = (node: AST.SnippetBlock): Message[] => {
        // use module runtime var because the snippet may be exported from the module
        const prevRtVar = this.currentRtVar
        const pattern = new RegExp(`\\b${node.expression.name}\\b`)
        if (this.moduleExportRanges.some(([start, end]) => pattern.test(this.content.slice(start, end)))) {
            this.currentRtVar = rtModuleVar
        }
        const msgs = this.visitFragment(node.body)
        this.currentRtVar = prevRtVar
        return msgs
    }

    visitIfBlock = (node: AST.IfBlock): Message[] => {
        const msgs = this.visit(node.test as AnyNode)
        msgs.push(...this.visitSv(node.consequent))
        if (node.alternate) {
            msgs.push(...this.visitSv(node.alternate))
        }
        return msgs
    }

    visitEachBlock = (node: AST.EachBlock): Message[] => {
        const msgs = [
            ...this.visit(node.expression as AnyNode),
            ...this.visitSv(node.body),
        ]
        if (node.key) {
            msgs.push(...this.visit(node.key as AnyNode))
        }
        if (node.fallback) {
            msgs.push(...this.visitSv(node.fallback))
        }
        return msgs
    }

    visitKeyBlock = (node: AST.KeyBlock): Message[] => {
        return [
            ...this.visit(node.expression as AnyNode),
            ...this.visitSv(node.fragment),
        ]
    }

    visitAwaitBlock = (node: AST.AwaitBlock): Message[] => {
        const msgs = this.visit(node.expression as AnyNode)
        if (node.then) {
            msgs.push(...this.visitFragment(node.then))
        }
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

    visitTitleElement = (node: AST.TitleElement): Message[] => this.visitRegularElement(node)

    visitSvelteWindow = (node: AST.SvelteWindow): Message[] => node.attributes.map(this.visitSv).flat()

    visitRoot = (node: AST.Root): Message[] => {
        const msgs: Message[] = []
        if (node.module) {
            const prevRtVar = this.currentRtVar
            this.currentRtVar = rtModuleVar
            this.runtimeCtx = {module: true}
            this.commentDirectives = {} // reset
            // @ts-expect-error
            msgs.push(...this.visitProgram(node.module.content))
            const runtimeInit = this.initRuntime(this.runtimeCtx)
            if (runtimeInit) {
                this.mstr.appendRight(
                    // @ts-expect-error
                    this.getRealBodyStart(node.module.content.body) ?? node.module.content.start,
                    runtimeInit,
                )
            }
            this.runtimeCtx = {module: false} // reset
            this.currentRtVar = prevRtVar // reset
        }
        if (node.instance) {
            this.commentDirectives = {} // reset
            msgs.push(...this.visitProgram(node.instance.content as Program))
        }
        msgs.push(...this.visitFragment(node.fragment))
        return msgs
    }

    visitSv = (node: AST.SvelteNode | AnyNode): Message[] => {
        if (node.type === 'Comment') {
            this.commentDirectives = processCommentDirectives(node.data.trim(), this.commentDirectives)
            if (this.lastVisitIsComment) {
                this.commentDirectivesStack[this.commentDirectivesStack.length - 1] = this.commentDirectives
            } else {
                this.commentDirectivesStack.push(this.commentDirectives)
            }
            this.lastVisitIsComment = true
            return []
        }
        if (node.type === 'Text' && !node.data.trim()) {
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
            msgs = this.visit(node as AnyNode)
        }
        this.commentDirectives = commentDirectivesPrev
        return msgs
    }

    /** collects the ranges that will be checked if a snippet identifier is exported using RegExp test to simplify */
    collectModuleExportRanges = (script: AST.Script) => {
        for (const stmt of script.content.body) {
            if (stmt.type !== 'ExportNamedDeclaration') {
                continue
            }
            for (const spec of stmt.specifiers) {
                if (spec.local.type === 'Identifier') {
                    const local = spec.local as Identifier
                    this.moduleExportRanges.push([local.start, local.end])
                }
            }
            const declaration = stmt.declaration as Declaration
            if (!declaration) {
                continue
            }
            if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
                this.moduleExportRanges.push([declaration.start, declaration.end])
                continue
            }
            for (const decl of declaration?.declarations ?? []) {
                if (!decl.init) {
                    continue
                }
                this.moduleExportRanges.push([decl.init.start, decl.init.end])
            }
        }
    }

    transformSv = async (): Promise<TransformOutput> => {
        const isComponent = this.filename.endsWith('.svelte')
        let ast: AST.Root | Program
        if (isComponent) {
            const prepd = await preprocess(this.content, {style: removeSCSS})
            ast = parse(prepd.code, { modern: true })
        } else {
            const [pAst, comments] = parseScript(this.content)
            ast = pAst
            this.comments = comments
        }
        this.mstr = new MagicString(this.content)
        this.mixedVisitor = this.initMixedVisitor()
        if (ast.type === 'Root' && ast.module) {
            this.collectModuleExportRanges(ast.module)
        }
        const msgs = this.visitSv(ast)
        const initRuntime = this.initRuntime(this.runtimeCtx)
        if (ast.type === 'Program') {
            const bodyStart = this.getRealBodyStart(ast.body) ?? 0
            if (initRuntime) {
                this.mstr.appendRight(bodyStart, initRuntime)
            }
            return this.finalize(msgs, bodyStart)
        }
        let headerIndex = 0
        if (ast.module) {
            // @ts-expect-error
            headerIndex = this.getRealBodyStart(ast.module.content.body) ?? ast.module.content.start
        }
        if (ast.instance) {
            // @ts-expect-error
            const instanceBodyStart = this.getRealBodyStart(ast.instance.content.body) ?? ast.instance.content.start
            if (!ast.module) {
                headerIndex = instanceBodyStart
            }
            if (initRuntime) {
                this.mstr.appendRight(instanceBodyStart, initRuntime)
            }
        } else {
            const instanceStart = ast.module?.end ?? 0
            this.mstr.prependLeft(instanceStart, '\n<script>')
            // account index for hmr data here
            this.mstr.prependRight(instanceStart, `${initRuntime}\n</script>\n`)
            // now hmr data can be prependRight(0, ...)
        }
        const headerAdd = `\nimport ${rtComponent} from "@wuchale/svelte/runtime.svelte"`
        return this.finalize(msgs, headerIndex, headerAdd)
    }
}
