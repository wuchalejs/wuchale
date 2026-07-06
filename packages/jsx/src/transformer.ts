import { tsPlugin } from '@sveltejs/acorn-typescript'
import type * as Estree from 'acorn'
import { Parser } from 'acorn'
import type * as JX from 'estree-jsx'
import type { CodePattern, HeuristicFunc, RuntimeConf, Text, TransformCtx, TransformOutput } from 'wuchale'
import { MixedVisitor, type ModFunc } from 'wuchale/adapter-utils'
import { parseScript, scriptParseOptionsWithComments, Transformer } from 'wuchale/adapter-vanilla'

const JsxParser = Parser.extend(tsPlugin({ jsx: true }))

export function parseScriptJSX(content: string): [Estree.Program, Estree.Comment[][]] {
    const [opts, comments] = scriptParseOptionsWithComments()
    return [JsxParser.parse(content, opts), comments]
}

const rtComponent = 'W_tx_'

type MixedNodesTypes = JX.JSXElement | JX.JSXFragment | JX.JSXText | JX.JSXExpressionContainer | JX.JSXSpreadChild

type MixedVisitorJSX = MixedVisitor<MixedNodesTypes, JX.JSXText, JX.JSXExpressionContainer, JX.JSXExpressionContainer>

export type JSXLib = 'default' | 'solidjs'

export class JSXTransformer extends Transformer {
    // state
    lastVisitIsComment: boolean = false
    currentJsxKey?: number

    mixedVisitor: MixedVisitorJSX

    constructor(ctx: TransformCtx, heuristic: HeuristicFunc, patterns: CodePattern[], rtConf: RuntimeConf) {
        super(ctx, heuristic, patterns, rtConf)
        this.mixedVisitor = this.initMixedVisitor()
    }

    initMixedVisitor(): MixedVisitorJSX {
        return new MixedVisitor({
            mstr: this.mstr,
            index: this.index,
            content: this.content,
            scopePath: this.scopePath,
            vars: this.vars.bind(this),
            getRange: node => ({
                start: node.start,
                end: node.end,
            }),
            isComment: (node): node is JX.JSXExpressionContainer =>
                node.type === 'JSXExpressionContainer' &&
                node.expression.type === 'JSXEmptyExpression' &&
                node.expression.end > node.expression.start,
            isText: node => node.type === 'JSXText',
            leaveInPlace: () => false,
            isExpression: node => node.type === 'JSXExpressionContainer',
            getTextContent: node => node.value,
            getCommentData: node => this.getMarkupCommentBody(node.expression as JX.JSXEmptyExpression),
            visitFunc: this.visitJx.bind(this),
            checkHeuristic: this.getHeuristicMessageType.bind(this),
            wrapNested: (index, hasExprs, nestedRanges, lastChildEnd) => {
                const vars = this.vars()
                let begin = `<${rtComponent}`
                if (nestedRanges.length > 0) {
                    for (const [i, [childStart, _, haveCtx]] of nestedRanges.entries()) {
                        let toAppend: string
                        if (i === 0) {
                            toAppend = `${begin} t={[`
                        } else {
                            toAppend = ', '
                        }
                        this.mstr.appendRight(childStart, `${toAppend}${haveCtx ? vars.nestCtx : '()'} => `)
                    }
                    begin = `]}`
                }
                begin += ' x='
                if (index === null) {
                    // nested
                    begin += `{${vars.nestCtx}} n`
                } else {
                    begin += `{${vars.rtCtx}(${index})}`
                }
                let end = ' />'
                if (hasExprs) {
                    begin += ' a={['
                    end = `]}${end}`
                }
                this.mstr.appendLeft(lastChildEnd, begin)
                this.mstr.appendRight(lastChildEnd, end)
            },
        })
    }

    visitChildrenJ(node: JX.JSXElement | JX.JSXFragment, nestable: boolean, addMod?: ModFunc): Text[] {
        return this.mixedVisitor.visit({
            children: node.children,
            nestable,
            commentDirectives: this.commentDirectives,
            addMod,
        })
    }

    visitNameJSXNamespacedName(node: JX.JSXNamespacedName): string {
        return `${this.visitName(node.namespace)}:${this.visitName(node.name)}`
    }

    visitNameJSXMemberExpression(node: JX.JSXMemberExpression): string {
        return `${this.visitName(node.object)}.${this.visitName(node.property)}`
    }

    visitNameJSXIdentifier(node: JX.JSXIdentifier): string {
        return node.name
    }

    visitName(node: JX.JSXIdentifier | JX.JSXMemberExpression | JX.JSXNamespacedName): string {
        return this[`visitName${node.type}` as `visitName${typeof node.type}`](node as any)
    }

    visitJSXElement(node: JX.JSXElement): Text[] {
        const alreadyInElement = this.scopePath.at(-1)!.type === 'element'
        return this.inScope({ type: 'element', name: this.visitName(node.openingElement.name) }, () => {
            let addMod: ModFunc | undefined
            const key = node.openingElement.attributes.find(
                attr => attr.type === 'JSXAttribute' && attr.name.name === 'key',
            )
            if (!key) {
                addMod = nested => {
                    if (!nested || this.currentJsxKey == null) {
                        return
                    }
                    this.mstr.appendLeft(node.openingElement.name.end, ` key="_${this.currentJsxKey}"`)
                    this.currentJsxKey++
                }
            }
            const txts = this.visitChildrenJ(node, alreadyInElement, addMod)
            for (const attr of node.openingElement.attributes) {
                txts.push(...this.visitJx(attr))
            }
            return txts
        })
    }

    visitJSXFragment(node: JX.JSXFragment): Text[] {
        const alreadyInElement = this.scopePath.at(-1)!.type === 'element'
        return this.inScope({ type: 'element', name: '' }, () => this.visitChildrenJ(node, alreadyInElement))
    }

    getMarkupCommentBody(node: JX.JSXEmptyExpression): string {
        const comment = this.content.slice(node.start, node.end).trim()
        if (!comment) {
            return ''
        }
        return comment.slice(2, -2).trim()
    }

    visitJSXExpressionContainer = (node: JX.JSXExpressionContainer): Text[] => {
        return this.inScopeVisit({ type: 'expression' }, node.expression as Estree.Expression)
    }

    visitJSXAttribute(node: JX.JSXAttribute): Text[] {
        if (node.value == null) {
            return []
        }
        let name: string
        if (node.name.type === 'JSXIdentifier') {
            name = node.name.name
        } else {
            name = node.name.name.name
        }
        const value = node.value
        return this.inScope({ type: 'attribute', name }, () => {
            if (value.type !== 'Literal') {
                if (value.type === 'JSXExpressionContainer') {
                    if (value.expression.type === 'Literal' && typeof value.expression.value === 'string') {
                        const expr = value.expression as Estree.Literal
                        return this.visitWithCommentDirectives(expr, () => this.visitLiteral(expr))
                    }
                    if (value.expression.type === 'TemplateLiteral') {
                        const expr = value.expression as Estree.TemplateLiteral
                        return this.visitWithCommentDirectives(expr, () => this.visitTemplateLiteral(expr))
                    }
                }
                return this.visitJx(value)
            }
            if (typeof value.value !== 'string') {
                return []
            }
            const [pass, txt] = this.checkHeuristicAllowNew(value.value)
            if (!pass) {
                return []
            }
            this.mstr.update(value.start, value.end, `{${this.literalRepl(txt)}}`)
            return [txt]
        })
    }

    visitJSXSpreadAttribute(node: JX.JSXSpreadAttribute): Text[] {
        return this.inScopeVisit({ type: 'attribute', name: '...' }, node.argument as Estree.Expression)
    }

    visitJx(node: JX.Node | JX.JSXSpreadChild | Estree.Program): Text[] {
        return this.visit(node as Estree.AnyNode)
    }

    transformJx(lib: JSXLib): TransformOutput {
        // jsx vs type casting is not ambiguous in all files except .ts files
        const [ast, comments] = (this.filename.endsWith('.ts') ? parseScript : parseScriptJSX)(this.content)
        this.comments = comments
        if (lib === 'default') {
            this.currentJsxKey = 0
        }
        const txts = this.visitJx(ast)
        const header = [
            `import ${rtComponent} from "@wuchale/jsx/runtime${lib === 'solidjs' ? '.solid' : ''}.jsx"`,
            this.initRuntime(),
        ].join('\n')
        const bodyStart = this.getRealBodyStart(ast.body) as number
        return this.finalize(txts, bodyStart, header)
    }
}
