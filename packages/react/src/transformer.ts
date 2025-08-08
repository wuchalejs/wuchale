import MagicString from "magic-string"
import { Parser, type AnyNode } from "acorn"
import { NestText } from 'wuchale/adapters'
import { tsPlugin } from '@sveltejs/acorn-typescript'
import jsx from 'acorn-jsx'
import { Transformer, runtimeConst, scriptParseOptions } from 'wuchale/adapter-vanilla'
import type {
    IndexTracker,
    HeuristicFunc,
    TransformOutput,
    CommentDirectives,
    TransformHeader
} from 'wuchale/adapters'

const JsxParser = Parser.extend(tsPlugin(), jsx())

export function parseScript(content: string) {
    return JsxParser.parse(content, scriptParseOptions)
}

const nodesWithChildren = ['RegularElement', 'Component']

const rtComponent = 'WuchaleTrans'
const snipPrefix = 'wuchaleSnippet'
const rtFuncCtx = `${runtimeConst}.cx`
const rtFuncCtxTrans = `${runtimeConst}.tx`

export class ReactTransformer extends Transformer {

    // state
    currentElement?: string
    inCompoundText: boolean = false
    commentDirectivesStack: CommentDirectives[] = []
    lastVisitIsComment: boolean = false
    currentSnippet: number = 0

    constructor(content: string, filename: string, index: IndexTracker, heuristic: HeuristicFunc, pluralsFunc: string, initInsideFuncExpr: string | null) {
        super(content, filename, index, heuristic, pluralsFunc, initInsideFuncExpr)
    }

    visitRe = (node: AnyNode): NestText[] => {
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

    transformRe = (header: TransformHeader): TransformOutput => {
        const ast = parseScript(this.content)
        this.mstr = new MagicString(this.content)
        const txts = this.visitRe(ast)
        if (!txts.length) {
            return this.finalize(txts)
        }
        const headerFin = [
            `\nimport ${rtComponent} from "@wuchale/svelte/runtime.svelte"`,
            header.head,
            `const ${runtimeConst} = ${header.expr}\n`,
        ].join('\n')
        this.mstr.appendRight(0, headerFin + '\n')
        return this.finalize(txts)
    }
}
