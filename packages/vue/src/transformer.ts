import type AST from '@vue/compiler-core'
import { NodeTypes } from '@vue/compiler-core'
import type { AnyNode } from 'acorn'
import { parse } from 'vue/compiler-sfc'
import type { CodePattern, HeuristicFunc, RuntimeConf, Text, TransformCtx, TransformOutput } from 'wuchale'
import type { WrapStrs } from 'wuchale/adapter-utils'
import { MixedVisitor, varNames } from 'wuchale/adapter-utils'
import { Transformer } from 'wuchale/adapter-vanilla'

const rtComponent = 'W_tx_'
const rtModuleVar = `${varNames.rt}mod_`

type MixedNodesTypes =
    | AST.TextNode
    | AST.ElementNode
    | AST.BlockStatement
    | AST.CommentNode
    | AST.ExpressionNode
    | AST.ForNode
    | AST.IfNode
    | AST.IfBranchNode
    | AST.InterpolationNode
    | AST.TextCallNode
type MixedVisitorVue = MixedVisitor<MixedNodesTypes, AST.TextNode, AST.CommentNode, AST.InterpolationNode>

export class VueTransformer extends Transformer {
    mixedVisitor: MixedVisitorVue

    constructor(ctx: TransformCtx, heuristic: HeuristicFunc, patterns: CodePattern[], rtConf: RuntimeConf) {
        super(ctx, heuristic, patterns, rtConf, [varNames.rt, rtModuleVar])
        this.mixedVisitor = this.initMixedVisitor()
    }

    [`visit${NodeTypes.INTERPOLATION}`](node: AST.InterpolationNode): Text[] {
        if (!node.content.ast) {
            return []
        }
        this.mstr.offset = node.loc.start.offset
        const txts = this.inScopeVisit({ type: 'expression' }, node.content.ast as AnyNode)
        this.mstr.offset = 0
        return txts
    }

    initMixedVisitor(): MixedVisitorVue {
        return new MixedVisitor({
            mstr: this.mstr,
            index: this.index,
            content: this.content,
            scopePath: this.scopePath,
            exprBorder: ['{{', '}}'],
            vars: this.vars.bind(this),
            getRange: node => ({ start: node.loc.start.offset, end: node.loc.end.offset }),
            isText: node => node.type === NodeTypes.TEXT,
            isComment: node => node.type === NodeTypes.COMMENT,
            leaveInPlace: () => false,
            isExpression: node => node.type === NodeTypes.INTERPOLATION,
            getTextContent: node => node.content,
            getCommentData: node => node.content.trim(),
            visitFunc: this.visitVu.bind(this),
            checkHeuristic: this.getHeuristicMessageType.bind(this),
            wrapNested: (index, hasExprs, needsCtx) => {
                const vars = this.vars()
                const strs: WrapStrs = { begin: `\n<${rtComponent} :x=`, end: `</${rtComponent}>\n`, children: [] }
                if (index === null) {
                    // nested
                    strs.begin += `"${vars.nestCtx}" :s="1"`
                } else {
                    strs.begin += `"${vars.rtCtx}(${index})"`
                }
                let beforeChild = '>'
                if (hasExprs) {
                    strs.begin += ' :a="['
                    beforeChild = `]"${beforeChild}`
                }
                if (needsCtx.length > 0) {
                    for (const [i, haveCtx] of needsCtx.entries()) {
                        const ctxArg = haveCtx ? `="{${vars.nestCtx}}"` : ''
                        strs.children.push(`${beforeChild}\n<template #[${i}]${ctxArg}>\n`)
                        beforeChild = '\n</template>'
                    }
                    strs.end = `${beforeChild}\n${strs.end}`
                }
                return strs
            },
        })
    }

    visitChildren(children: AST.TemplateChildNode[], nestable: boolean): Text[] {
        return this.mixedVisitor.visit({
            children: children,
            nestable,
            commentDirectives: this.commentDirectives,
            useComponent: true,
        })
    }

    [`visit${NodeTypes.ELEMENT}`](node: AST.ElementNode): Text[] {
        return this.inScope({ type: 'element', name: node.tag }, () => {
            const txts: Text[] = []
            for (const attrib of node.props) {
                txts.push(...this.visitVu(attrib))
            }
            txts.push(...this.visitChildren(node.children, true))
            return txts
        })
    }

    [`visit${NodeTypes.ATTRIBUTE}`](node: AST.AttributeNode): Text[] {
        return this.inScope({ type: 'attribute', name: node.name }, () => {
            const value = node.value
            if (!value) {
                return []
            }
            const [pass, txt] = this.checkHeuristicAllowNew(value.content)
            if (!pass) {
                return []
            }
            const start = value.loc.start.offset
            const end = value.loc.end.offset
            this.mstr.update(start, end, `{${this.literalRepl(txt)}}`)
            if (`'"`.includes(this.content[start - 1]!)) {
                this.mstr.remove(start - 1, start)
                this.mstr.remove(end, end + 1)
            }
            return [txt]
        })
    }

    [`visit${NodeTypes.ROOT}`](node: AST.RootNode): Text[] {
        return this.inScope({ type: 'element', name: '' }, () => this.visitChildren(node.children, false))
    }

    visitVu(node: AST.Node | AnyNode): Text[] {
        return this.visit(node as AnyNode)
    }

    transformSv(rtComponentFile: string): TransformOutput {
        const sfc = parse(this.content)
        const templateAst = sfc.descriptor.template?.ast
        const txts: Text[] = []
        if (templateAst) {
            txts.push(...this.visitVu(templateAst))
        }
        return this.finalize(txts, 0, `\nimport ${rtComponent} from "${rtComponentFile}"`)
    }
}
