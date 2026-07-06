import type {
    AnyNode,
    Declaration,
    Expression,
    Identifier,
    Literal,
    Program,
    TemplateLiteral,
    VariableDeclarator,
} from 'acorn'
import { type AST, type Preprocessor, parse, preprocess } from 'svelte/compiler'
import type { CodePattern, HeuristicFunc, RuntimeConf, Text, TransformCtx, TransformOutput } from 'wuchale'
import { MixedVisitor, varNames } from 'wuchale/adapter-utils'
import { parseScript, Transformer } from 'wuchale/adapter-vanilla'

const noWrapTopCalls = ['$props', '$state', '$derived', '$effect']

const rtComponent = 'W_tx_'
const headerAdd = `\nimport ${rtComponent} from "@wuchale/svelte/runtime.svelte"`
const snipPrefix = '_w_snippet_'
const rtModuleVar = `${varNames.rt}mod_`

type MixedNodesTypes = AST.Text | AST.Tag | AST.ElementLike | AST.SvelteElement | AST.Block | AST.Comment
type MixedVisitorSvelte = MixedVisitor<MixedNodesTypes, AST.Text, AST.Comment, AST.ExpressionTag>

// for use before actually parsing the code,
// to remove the contents of e.g. <style lang="scss"> which can cause parse errors
// without messing up indices for magic-string
const removeCSS: Preprocessor = ({ content }) => ({
    code: ' '.repeat(content.length),
})

export type RuntimeCtxSv = {
    // inside of <script module> or not
    module: boolean
}

export class SvelteTransformer extends Transformer {
    // state
    currentSnippet = 0
    moduleExportExprs: AnyNode[] = [] // to choose which runtime var to use for snippets

    mixedVisitor: MixedVisitorSvelte

    constructor(ctx: TransformCtx, heuristic: HeuristicFunc, patterns: CodePattern[], rtConf: RuntimeConf) {
        super(ctx, heuristic, patterns, rtConf, [varNames.rt, rtModuleVar])
        this.mixedVisitor = this.initMixedVisitor()
    }

    visitExpressionTag(node: AST.ExpressionTag): Text[] {
        return this.inScopeVisit({ type: 'expression' }, node.expression as AnyNode)
    }

    override visitVariableDeclarator(node: VariableDeclarator): Text[] {
        const txts = super.visitVariableDeclarator(node)
        const init = node.init
        if (
            !txts.length ||
            this.scopePath.some(s => s.type === 'assignment') ||
            init == null ||
            init.type === 'ArrowFunctionExpression' ||
            init.type === 'FunctionExpression'
        ) {
            return txts
        }
        const needsWrapping = txts.some(txt => {
            for (const s of txt.path) {
                if (s.type === 'assignment') {
                    if (s.left) {
                        return false
                    }
                } else if (s.type === 'call' && (noWrapTopCalls.includes(s.name) || noWrapTopCalls.some(c => s.name.startsWith(`${c}.`)))) {
                    return false
                }
            }
            return true
        })
        if (!needsWrapping) {
            return txts
        }
        const isExported = this.moduleExportExprs.some(node => init.start >= node.start && init.end <= node.end)
        if (!isExported && this.initReactive()) {
            this.mstr.appendLeft(init.start, '$derived(')
            this.mstr.appendRight(init.end, ')')
        }
        return txts
    }

    initMixedVisitor(): MixedVisitorSvelte {
        return new MixedVisitor({
            mstr: this.mstr,
            index: this.index,
            content: this.content,
            scopePath: this.scopePath,
            vars: this.vars.bind(this),
            getRange: node => ({ start: node.start, end: node.end }),
            isText: node => node.type === 'Text',
            isComment: node => node.type === 'Comment',
            leaveInPlace: node => ['ConstTag', 'SnippetBlock', 'DeclarationTag'].includes(node.type),
            isExpression: node => node.type === 'ExpressionTag',
            getTextContent: node => node.data,
            getCommentData: node => node.data.trim(),
            visitFunc: this.visitSv.bind(this),
            checkHeuristic: this.getHeuristicMessageType.bind(this),
            wrapNested: (index, hasExprs, nestedRanges, lastChildEnd) => {
                const snippets: string[] = []
                const vars = this.vars()
                // create and reference snippets
                for (const [childStart, childEnd, haveCtx] of nestedRanges) {
                    const snippetName = `${snipPrefix}${this.currentSnippet}`
                    snippets.push(snippetName)
                    this.currentSnippet++
                    const snippetBegin = `\n{#snippet ${snippetName}(${haveCtx ? vars.nestCtx : ''})}\n`
                    this.mstr.appendRight(childStart, snippetBegin)
                    this.mstr.prependLeft(childEnd, '\n{/snippet}\n')
                }
                let begin = `\n<${rtComponent}`
                if (snippets.length) {
                    begin += ` t={[${snippets.join(', ')}]}`
                }
                begin += ' x='
                if (index === null) {
                    // nested
                    begin += `{${vars.nestCtx}} n`
                } else {
                    begin += `{${vars.rtCtx}(${index})}`
                }
                let end = ' />\n'
                if (hasExprs) {
                    begin += ' a={['
                    end = `]}${end}`
                }
                this.mstr.appendLeft(lastChildEnd, begin)
                this.mstr.appendRight(lastChildEnd, end)
            },
        })
    }

    visitFragment(node: AST.Fragment, nestable = false): Text[] {
        const scope = this.scopePath.at(-1)!
        return this.mixedVisitor.visit({
            children: node.nodes,
            nestable,
            commentDirectives: this.commentDirectives,
            useComponent: scope.type !== 'element' || scope.name !== 'title',
        })
    }

    visitRegularElement(node: AST.ElementLike): Text[] {
        return this.inScope({ type: 'element', name: node.name }, () => {
            const txts: Text[] = []
            for (const attrib of node.attributes) {
                txts.push(...this.visitSv(attrib))
            }
            txts.push(...this.visitFragment(node.fragment, true))
            return txts
        })
    }

    visitComponent(node: AST.Component) {
        return this.visitRegularElement(node)
    }

    visitSpreadAttribute(node: AST.SpreadAttribute): Text[] {
        return this.inScopeVisit({ type: 'attribute', name: '...' }, node.expression as AnyNode)
    }

    visitAttribute(node: AST.Attribute): Text[] {
        if (node.value === true) {
            return []
        }
        let values: (AST.ExpressionTag | AST.Text)[]
        if (Array.isArray(node.value)) {
            values = node.value
        } else {
            values = [node.value]
        }
        return this.inScope({ type: 'attribute', name: node.name }, () => {
            if (values.length > 1) {
                return this.mixedVisitor.visit({
                    children: values,
                    nestable: false,
                    commentDirectives: this.commentDirectives,
                })
            }
            const value = values[0]!
            if (value.type === 'ExpressionTag') {
                if (value.expression.type === 'Literal') {
                    const expr = value.expression as Literal
                    return this.visitWithCommentDirectives(expr, () => this.visitLiteral(expr))
                }
                if (value.expression.type === 'TemplateLiteral') {
                    const expr = value.expression as TemplateLiteral
                    return this.visitWithCommentDirectives(expr, () => this.visitTemplateLiteral(expr))
                }
                return this.visitSv(value)
            }
            const [pass, txt] = this.checkHeuristicAllowNew(value.data)
            if (!pass) {
                return []
            }
            this.mstr.update(value.start, value.end, `{${this.literalRepl(txt)}}`)
            if (`'"`.includes(this.content[value.start - 1]!)) {
                this.mstr.remove(value.start - 1, value.start)
                this.mstr.remove(value.end, value.end + 1)
            }
            return [txt]
        })
    }

    visitConstTag(node: AST.ConstTag): Text[] {
        // @ts-expect-error
        return this.visitVariableDeclaration(node.declaration)
    }

    visitDeclarationTag(node: AST.DeclarationTag): Text[] {
        // @ts-expect-error
        return this.visitVariableDeclaration(node.declaration)
    }

    visitRenderTag(node: AST.RenderTag): Text[] {
        return this.visit(node.expression as Expression)
    }

    visitHtmlTag(node: AST.HtmlTag): Text[] {
        return this.visit(node.expression as Expression)
    }

    visitOnDirective(node: AST.OnDirective): Text[] {
        return node.expression ? this.visit(node.expression as Expression) : []
    }

    hasIdentifier(node: AnyNode | AnyNode[], name: string): boolean {
        if (!node || typeof node !== 'object') {
            return false
        }
        if (Array.isArray(node)) {
            return node.some(child => this.hasIdentifier(child, name))
        }
        if (node.type === 'Identifier') {
            return node.name === name
        }
        return Object.values(node).some(value => this.hasIdentifier(value, name))
    }

    visitSnippetBlock(node: AST.SnippetBlock): Text[] {
        // use module runtime var because the snippet may be exported from the module
        const prevRtVar = this.currentRtVar
        if (this.hasIdentifier(this.moduleExportExprs, node.expression.name)) {
            this.currentRtVar = rtModuleVar
        }
        const txts = this.visitFragment(node.body, false)
        this.currentRtVar = prevRtVar
        return txts
    }

    visitIfBlock(node: AST.IfBlock): Text[] {
        const txts = this.visit(node.test as AnyNode)
        txts.push(...this.visitFragment(node.consequent, false))
        if (node.alternate) {
            txts.push(...this.visitFragment(node.alternate, false))
        }
        return txts
    }

    visitEachBlock(node: AST.EachBlock): Text[] {
        const txts = [...this.visit(node.expression as AnyNode), ...this.visitFragment(node.body, false)]
        if (node.key) {
            txts.push(...this.visit(node.key as AnyNode))
        }
        if (node.fallback) {
            txts.push(...this.visitFragment(node.fallback, false))
        }
        return txts
    }

    visitKeyBlock(node: AST.KeyBlock): Text[] {
        return [...this.visit(node.expression as AnyNode), ...this.visitFragment(node.fragment, false)]
    }

    visitAwaitBlock(node: AST.AwaitBlock): Text[] {
        const txts = this.visit(node.expression as AnyNode)
        if (node.then) {
            txts.push(...this.visitFragment(node.then, false))
        }
        if (node.pending) {
            txts.push(...this.visitFragment(node.pending, false))
        }
        if (node.catch) {
            txts.push(...this.visitFragment(node.catch, false))
        }
        return txts
    }

    visitSvelteBody(node: AST.SvelteBody): Text[] {
        return node.attributes.flatMap(n => this.visitSv(n))
    }

    visitSvelteDocument(node: AST.SvelteDocument): Text[] {
        return node.attributes.flatMap(n => this.visitSv(n))
    }

    visitSvelteElement(node: AST.SvelteElement): Text[] {
        let name = 'svelte:element'
        if (node.tag.type === 'Literal' && typeof node.tag.value === 'string') {
            name = node.tag.value
        }
        return this.inScope({ type: 'element', name }, () => [
            ...node.attributes.flatMap(n => this.visitSv(n)),
            ...this.visitFragment(node.fragment, true),
        ])
    }

    visitSvelteBoundary(node: AST.SvelteBoundary): Text[] {
        return [...node.attributes.flatMap(n => this.visitSv(n)), ...this.visitSv(node.fragment)]
    }

    visitSvelteHead(node: AST.SvelteHead): Text[] {
        return this.visitSv(node.fragment)
    }

    visitTitleElement(node: AST.TitleElement): Text[] {
        return this.visitRegularElement(node)
    }

    visitSvelteWindow(node: AST.SvelteWindow): Text[] {
        return node.attributes.flatMap(n => this.visitSv(n))
    }

    visitRoot(node: AST.Root): Text[] {
        const txts: Text[] = []
        if (node.module) {
            const prevRtVar = this.currentRtVar
            this.currentRtVar = rtModuleVar
            this.runtimeCtx = { module: true }
            this.commentDirectives = {} // reset
            // @ts-expect-error
            txts.push(...this.visitProgram(node.module.content))
            const runtimeInit = this.initRuntime()
            if (runtimeInit) {
                this.mstr.appendRight(
                    // @ts-expect-error
                    this.getRealBodyStart(node.module.content.body) ?? node.module.content.start,
                    runtimeInit,
                )
            }
            this.runtimeCtx = { module: false } // reset
            this.currentRtVar = prevRtVar // reset
        }
        if (node.instance) {
            this.commentDirectives = {} // reset
            txts.push(...this.visitProgram(node.instance.content as Program))
        }
        txts.push(...this.inScope({ type: 'element', name: '' }, () => this.visitFragment(node.fragment, false)))
        return txts
    }

    visitSv(node: AST.SvelteNode | AnyNode): Text[] {
        return this.visit(node as AnyNode)
    }

    /** collects the ranges that will be checked if a snippet identifier is exported using RegExp test to simplify */
    collectModuleExportExprs(script: AST.Script) {
        for (const stmt of script.content.body) {
            if (stmt.type !== 'ExportNamedDeclaration') {
                continue
            }
            for (const spec of stmt.specifiers) {
                if (spec.local.type === 'Identifier') {
                    const local = spec.local as Identifier
                    this.moduleExportExprs.push(local)
                }
            }
            const declaration = stmt.declaration as Declaration
            if (!declaration) {
                continue
            }
            if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
                this.moduleExportExprs.push(declaration)
                continue
            }
            for (const decl of declaration?.declarations ?? []) {
                if (!decl.init) {
                    continue
                }
                this.moduleExportExprs.push(decl.init)
            }
        }
    }

    async transformSv(): Promise<TransformOutput> {
        const isComponent = this.filename.endsWith('.svelte')
        let ast: AST.Root | Program
        if (isComponent) {
            const prepd = await preprocess(this.content, { style: removeCSS })
            ast = parse(prepd.code, { modern: true })
        } else {
            ;[ast, this.comments] = parseScript(this.content)
        }
        if (ast.type === 'Root' && ast.module) {
            this.collectModuleExportExprs(ast.module)
        }
        const txts = this.visitSv(ast)
        const initRuntime = this.initRuntime()
        if (ast.type === 'Program') {
            const bodyStart = this.getRealBodyStart(ast.body) ?? 0
            if (initRuntime) {
                this.mstr.appendRight(bodyStart, initRuntime)
            }
            return this.finalize(txts, bodyStart)
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
        return this.finalize(txts, headerIndex, headerAdd)
    }
}
