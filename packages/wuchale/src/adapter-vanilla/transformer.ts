// $$ cd .. && npm run test

import MagicString from "magic-string"
import type * as Estree from "acorn"
import { Parser } from 'acorn'
import { tsPlugin } from '@sveltejs/acorn-typescript'
import { defaultHeuristicFuncOnly, Message } from '../adapters.js'
import type {
    CommentDirectives,
    HeuristicDetailsBase,
    HeuristicFunc,
    IndexTracker,
    ScriptDeclType,
    TransformOutput,
    HeuristicDetails,
    RuntimeConf,
    CatalogExpr,
} from "../adapters.js"
import { runtimeVars, varNames, type RuntimeVars } from "../adapter-utils/index.js"

export const scriptParseOptions: Estree.Options = {
    sourceType: 'module',
    ecmaVersion: 'latest',
    locations: true
}

const ScriptParser = Parser.extend(tsPlugin())

export function scriptParseOptionsWithComments(): [Estree.Options, Estree.Comment[][]] {
    let accumulateComments: Estree.Comment[] = []
    const comments: Estree.Comment[][] = []
    return [
        {
            ...scriptParseOptions,
            // parse comments for when they are not part of the AST
            onToken: token => {
                if (accumulateComments.length) {
                    comments[token.start] = accumulateComments
                }
                accumulateComments = []
            },
            onComment: (block, comment) => {
                accumulateComments.push({
                    type: block ? 'Block' : 'Line',
                    value: comment,
                    start: null,
                    end: null,
                })
            }
        },
        comments,
    ]
}

export function parseScript(content: string): [Estree.Program, Estree.Comment[][]] {
    const [opts, comments] = scriptParseOptionsWithComments()
    return [ScriptParser.parse(content, opts), comments]
}

function initRuntimeStmt(rtConf: RuntimeConf, expr: CatalogExpr) {
    return (file: string, funcName: string, parentFunc: string, additional: object) => {
        const useReactive = rtConf.useReactive({funcName, nested: parentFunc != null, file, additional})
        if (useReactive.init == null) {
            return
        }
        const wrapInit = useReactive.init ? rtConf.reactive.wrapInit : rtConf.plain.wrapInit
        const catalogExpr = useReactive.init ? expr.reactive : expr.plain
        const runtimeExpr = `${varNames.rtWrap}(${catalogExpr})`
        return `\nconst ${varNames.rt} = ${wrapInit(runtimeExpr)}\n`
    }
}

export class Transformer {

    index: IndexTracker
    heuristic: HeuristicFunc
    content: string
    /* for when the comments are not parsed as part of the AST */
    comments: Estree.Comment[][] = []
    filename: string
    mstr: MagicString
    pluralFunc: string
    initRuntime: ReturnType<typeof initRuntimeStmt>
    vars: () => RuntimeVars

    // state
    commentDirectives: CommentDirectives = {}
    insideProgram: boolean = false
    declaring: ScriptDeclType = null
    currentFuncNested: boolean = false
    currentFuncDef: string | null = null
    currentCall: string
    currentTopLevelCall: string
    /** for subclasses. right now for svelte, if in <script module> */
    additionalState: object = {}

    constructor(content: string, filename: string, index: IndexTracker, heuristic: HeuristicFunc, pluralsFunc: string, catalogExpr: CatalogExpr, rtConf: RuntimeConf) {
        this.index = index
        this.heuristic = heuristic
        this.pluralFunc = pluralsFunc
        this.content = content
        this.filename = filename
        this.initRuntime = initRuntimeStmt(rtConf, catalogExpr)
        const topLevelUseReactive = rtConf.useReactive({
            funcName: null,
            nested: false,
            file: filename,
            additional: this.additionalState,
        })
        const reactiveVars = rtConf.reactive?.wrapUse && runtimeVars(rtConf.reactive.wrapUse)
        const plainVars = rtConf.plain?.wrapUse && runtimeVars(rtConf.plain.wrapUse)
        this.vars = () => {
            const useReactive = rtConf.useReactive({
                funcName: this.currentFuncDef,
                nested: this.currentFuncNested,
                file: filename,
                additional: this.additionalState,
            }) ?? topLevelUseReactive
            return useReactive.use ? reactiveVars : plainVars
        }
    }

    checkHeuristicBool: HeuristicFunc<HeuristicDetailsBase> = (msgStr, detailsBase): boolean => {
        if (!msgStr) {
            // nothing to ask
            return false
        }
        let extract = this.commentDirectives.forceInclude
        if (extract == null) {
            const details: HeuristicDetails = {
                file: this.filename,
                call: this.currentCall,
                declaring: this.declaring,
                funcName: this.currentFuncDef,
                topLevelCall: this.currentTopLevelCall,
                ...detailsBase,
            }
            if (details.declaring == null && this.insideProgram) {
                details.declaring = 'expression'
            }
            extract = this.heuristic(msgStr, details) ?? defaultHeuristicFuncOnly(msgStr, details) ?? true
        }
        return extract
    }

    checkHeuristic = (msgStr: string, detailsBase: HeuristicDetailsBase): [boolean, Message] => {
        if (!msgStr) {
            // nothing to ask
            return [false, null]
        }
        let extract = this.checkHeuristicBool(msgStr, detailsBase)
        return [extract, new Message(msgStr, detailsBase.scope, this.commentDirectives.context)]
    }

    visitLiteral = (node: Estree.Literal & { start: number; end: number }): Message[] => {
        if (typeof node.value !== 'string') {
            return []
        }
        const { start, end } = node
        const [pass, msgInfo] = this.checkHeuristic(node.value, { scope: 'script' })
        if (!pass) {
            return []
        }
        this.mstr.update(start, end, `${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})`)
        return [msgInfo]
    }

    visitArrayExpression = (node: Estree.ArrayExpression): Message[] => node.elements.map(this.visit).flat()

    visitObjectExpression = (node: Estree.ObjectExpression): Message[] => node.properties.map(this.visit).flat()

    visitObjectPattern = (node: Estree.ObjectPattern): Message[] => node.properties.map(this.visit).flat()

    visitRestElement = (node: Estree.RestElement): Message[] => this.visit(node.argument)

    visitProperty = (node: Estree.Property): Message[] => {
        const msgs = this.visit(node.key)
        if (msgs.length && node.key.type === 'Literal' && typeof node.key.value === 'string' && !node.computed) {
            this.mstr.appendRight(node.key.start, '[')
            this.mstr.appendLeft(node.key.end, ']')
        }
        msgs.push(...this.visit(node.value))
        return msgs
    }

    visitSpreadElement = (node: Estree.SpreadElement): Message[] => this.visit(node.argument)

    visitMemberExpression = (node: Estree.MemberExpression): Message[] => [
        ...this.visit(node.object),
        ...this.visit(node.property),
    ]

    visitNewExpression = (node: Estree.NewExpression): Message[] => node.arguments.map(this.visit).flat()

    defaultVisitCallExpression = (node: Estree.CallExpression): Message[] => {
        const msgs = this.visit(node.callee)
        const currentCall = this.currentCall
        this.currentCall = this.getCalleeName(node.callee)
        for (const arg of node.arguments) {
            msgs.push(...this.visit(arg))
        }
        this.currentCall = currentCall // restore
        return msgs
    }

    visitCallExpression = (node: Estree.CallExpression): Message[] => {
        if (node.callee.type !== 'Identifier' || node.callee.name !== this.pluralFunc) {
            return this.defaultVisitCallExpression(node)
        }
        // plural(num, ['Form one', 'Form two'])
        const secondArg = node.arguments[1]
        if (secondArg === null || secondArg.type !== 'ArrayExpression') {
            return this.defaultVisitCallExpression(node)
        }
        const candidates = []
        for (const elm of secondArg.elements) {
            if (elm.type !== 'Literal' || typeof elm.value !== 'string') {
                return this.defaultVisitCallExpression(node)
            }
            candidates.push(elm.value)
        }
        const msgInfo = new Message(candidates, 'script', this.commentDirectives.context)
        msgInfo.plural = true
        const index = this.index.get(msgInfo.toKey())
        const pluralUpdate = `${this.vars().rtTPlural}(${index}), ${this.vars().rtPlural}`
        // @ts-ignore
        this.mstr.update(secondArg.start, node.end - 1, pluralUpdate)
        return [msgInfo]
    }

    visitBinaryExpression = (node: Estree.BinaryExpression): Message[] => [
        ...this.visit(node.left),
        ...this.visit(node.right),
    ]

    visitConditionalExpression = (node: Estree.ConditionalExpression): Message[] => [
        ...this.visit(node.test),
        ...this.visit(node.consequent),
        ...this.visit(node.alternate),
    ]

    visitUnaryExpression = (node: Estree.UnaryExpression): Message[] => this.visit(node.argument)

    visitLogicalExpression = (node: Estree.LogicalExpression): Message[] => [
        ...this.visit(node.left),
        ...this.visit(node.right),
    ]

    visitAwaitExpression = (node: Estree.AwaitExpression): Message[] => this.visit(node.argument)

    visitAssignmentExpression = this.visitBinaryExpression

    visitAssignmentPattern = (node: Estree.AssignmentPattern): Message[] => [
        ...this.visit(node.left),
        ...this.visit(node.right),
    ]

    visitExpressionStatement = (node: Estree.ExpressionStatement): Message[] => this.visit(node.expression)

    visitForOfStatement = (node: Estree.ForOfStatement): Message[] => [
        ...this.visit(node.left),
        ...this.visit(node.right),
        ...this.visit(node.body),
    ]

    visitForInStatement = (node: Estree.ForInStatement): Message[] => [
        ...this.visit(node.left),
        ...this.visit(node.right),
        ...this.visit(node.body),
    ]

    visitForStatement = (node: Estree.ForStatement): Message[] => [
        ...this.visit(node.init),
        ...this.visit(node.test),
        ...this.visit(node.update),
        ...this.visit(node.body),
    ]

    getMemberChainName = (node: Estree.MemberExpression): string => {
        let name = ''
        if (node.object.type === 'Identifier') {
            name = node.object.name
        } else if (node.object.type === 'MemberExpression') {
            name = this.getMemberChainName(node.object)
        } else {
            name = `[${node.type}]`
        }
        name += '.'
        if (node.property.type === 'Identifier') {
            name += node.property.name
        } else if (node.property.type === 'MemberExpression') {
            name += this.getMemberChainName(node.property)
        } else {
            name = `[${node.type}]`
        }
        return name
    }

    getCalleeName = (callee: Estree.Expression | Estree.Super): string => {
        if (callee.type === 'Identifier') {
            return callee.name
        }
        if (callee.type === 'MemberExpression') {
            return this.getMemberChainName(callee)
        }
        return `[${callee.type}]`
    }

    visitVariableDeclaration = (node: Estree.VariableDeclaration): Message[] => {
        const msgs = []
        let atTopLevelDefn = this.insideProgram && !this.declaring
        for (const dec of node.declarations) {
            if (!dec.init) {
                continue
            }
            msgs.push(...this.visit(dec.id))
            // store the name of the function after =
            if (atTopLevelDefn) {
                if (dec.init.type === 'ArrowFunctionExpression') {
                    this.declaring = 'function'
                } else {
                    this.declaring = 'variable'
                    if (dec.init.type === 'CallExpression') {
                        this.currentTopLevelCall = this.getCalleeName(dec.init.callee)
                    }
                }
            }
            const decVisit = this.visit(dec.init)
            if (!decVisit.length) {
                continue
            }
            msgs.push(...decVisit)
        }
        if (atTopLevelDefn) {
            this.currentTopLevelCall = null // reset
            this.declaring = null
        }
        return msgs
    }

    visitExportNamedDeclaration = (node: Estree.ExportNamedDeclaration): Message[] => node.declaration ? this.visit(node.declaration) : []

    visitExportDefaultDeclaration = this.visitExportNamedDeclaration

    visitFunctionBody = (node: Estree.BlockStatement | Estree.Expression, name: string | null): Message[] => {
        const prevFuncDef = this.currentFuncDef
        const prevFuncNested = this.currentFuncNested
        const isBlock = node.type === 'BlockStatement'
        this.currentFuncDef = isBlock ? name : prevFuncDef
        this.currentFuncNested = isBlock && name != null && prevFuncDef != null
        const msgs = this.visit(node)
        if (msgs.length > 0 && isBlock) {
            const initRuntime = this.initRuntime(this.filename, this.currentFuncDef, prevFuncDef, this.additionalState)
            initRuntime && this.mstr.prependLeft(
                node.start + 1,
                initRuntime,
            )
        }
        this.currentFuncNested = prevFuncNested
        this.currentFuncDef = prevFuncDef
        return msgs
    }

    visitFunctionDeclaration = (node: Estree.FunctionDeclaration): Message[] => {
        const declaring = this.declaring
        this.declaring = 'function'
        const msgs = this.visitFunctionBody(node.body, node.id?.name ?? '')
        this.declaring = declaring
        return msgs
    }

    visitArrowFunctionExpression = (node: Estree.ArrowFunctionExpression): Message[] => this.visitFunctionBody(node.body, '')

    visitFunctionExpression = (node: Estree.FunctionExpression): Message[] => this.visitFunctionBody(node.body, '')

    visitBlockStatement = (node: Estree.BlockStatement): Message[] => node.body.map(this.visit).flat()

    visitReturnStatement = (node: Estree.ReturnStatement): Message[] => node.argument ? this.visit(node.argument) : []

    visitIfStatement = (node: Estree.IfStatement): Message[] => {
        const msgs = this.visit(node.test)
        msgs.push(...this.visit(node.consequent))
        if (node.alternate) {
            msgs.push(...this.visit(node.alternate))
        }
        return msgs
    }

    visitTemplateLiteral = (node: Estree.TemplateLiteral): Message[] => {
        let heurTxt = ''
        for (const quasi of node.quasis) {
            heurTxt += quasi.value.cooked ?? ''
            if (!quasi.tail) {
                heurTxt += '#'
            }
        }
        heurTxt = heurTxt.trim()
        const [pass] = this.checkHeuristic(heurTxt, { scope: 'script' })
        if (!pass) {
            return node.expressions.map(this.visit).flat()
        }
        const msgs = []
        const quasi0 = node.quasis[0]
        // @ts-ignore
        const { start: start0, end: end0 } = quasi0
        let msgStr = quasi0.value?.cooked ?? ''
        for (const [i, expr] of node.expressions.entries()) {
            msgs.push(...this.visit(expr))
            const quasi = node.quasis[i + 1]
            msgStr += `{${i}}${quasi.value.cooked}`
            // @ts-ignore
            const { start, end } = quasi
            this.mstr.remove(start - 1, end)
            if (i + 1 === node.expressions.length) {
                continue
            }
            this.mstr.update(end, end + 2, ', ')
        }
        const msgInfo = new Message(msgStr, 'script', this.commentDirectives.context)
        let begin = `${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())}`
        let end = ')'
        if (node.expressions.length) {
            begin += ', ['
            end = ']' + end
            this.mstr.update(start0 - 1, end0 + 2, begin)
            // @ts-ignore
            this.mstr.update(node.end - 1, node.end, end)
        } else {
            this.mstr.update(start0 - 1, end0 + 1, begin + end)
        }
        msgs.push(msgInfo)
        return msgs
    }

    visitProgram = (node: Estree.Program): Message[] => {
        const msgs = []
        this.insideProgram = true
        for (const child of node.body) {
            msgs.push(...this.visit(child))
        }
        this.insideProgram = false
        return msgs
    }

    processCommentDirectives = (data: string): CommentDirectives => {
        const directives: CommentDirectives = { ...this.commentDirectives }
        if (data === '@wc-ignore') {
            directives.forceInclude = false
        }
        if (data === '@wc-include') {
            directives.forceInclude = true
        }
        const ctxStart = '@wc-context:'
        if (data.startsWith(ctxStart)) {
            directives.context = data.slice(ctxStart.length).trim()
        }
        return directives
    }

    visit = (node: Estree.AnyNode): Message[] => {
        // for estree
        const commentDirectives = { ...this.commentDirectives }
        const comments = this.comments[node.start]
        // @ts-expect-error
        for (const comment of node.leadingComments ?? comments ?? []) {
            this.commentDirectives = this.processCommentDirectives(comment.value.trim())
        }
        let msgs = []
        if (this.commentDirectives.forceInclude !== false) {
            const methodName = `visit${node.type}`
            if (methodName in this) {
                msgs = this[methodName](node)
            // } else {
            //     console.log(node)
            }
        }
        this.commentDirectives = commentDirectives // restore
        return msgs
    }

    finalize = (msgs: Message[], hmrHeaderIndex: number): TransformOutput => ({
        msgs,
        output: hmrData => {
            if (msgs.length === 0) {
                return {}
            }
            if (hmrData) {
                this.mstr.prependRight(hmrHeaderIndex, `\nconst ${varNames.hmrUpdate} = ${JSON.stringify(hmrData)}\n`)
            }
            return {
                code: this.mstr.toString(),
                map: this.mstr.generateMap(),
            }
        }
    })

    transform = (headerHead: string): TransformOutput => {
        const [ast, comments] = parseScript(this.content)
        this.comments = comments
        this.mstr = new MagicString(this.content)
        const msgs = this.visit(ast)
        if (msgs.length) {
            this.mstr.appendRight(0, headerHead + '\n')
        }
        return this.finalize(msgs, 0)
    }
}
