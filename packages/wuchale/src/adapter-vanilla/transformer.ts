// $$ cd .. && npm run test

import { tsPlugin } from '@sveltejs/acorn-typescript'
import type * as Estree from 'acorn'
import { Parser } from 'acorn'
import MagicString from 'magic-string'
import {
    type CommentDirectives,
    type RuntimeVars,
    runtimeVars,
    updateCommentDirectives,
    varNames,
} from '../adapter-utils/index.js'
import type {
    CatalogExpr,
    CodePattern,
    HeuristicDetails,
    HeuristicDetailsBase,
    HeuristicFunc,
    HeuristicResultChecked,
    IndexTracker,
    MessageType,
    RuntimeConf,
    TransformOutput,
    UrlMatcher,
} from '../adapters.js'
import { defaultHeuristicFuncOnly, Message } from '../adapters.js'

export const scriptParseOptions: Estree.Options = {
    sourceType: 'module',
    ecmaVersion: 'latest',
    locations: true,
}

const ScriptParser = Parser.extend(tsPlugin())

export function scriptParseOptionsWithComments(): [Estree.Options, Estree.Comment[][]] {
    let accumulateComments: Estree.Comment[] = []
    const comments: Estree.Comment[][] = []
    return [
        {
            ...scriptParseOptions,
            // parse comments for when they are not part of the AST
            onToken: (token) => {
                if (accumulateComments.length) {
                    comments[token.start] = accumulateComments
                }
                accumulateComments = []
            },
            onComment: (block, comment) => {
                accumulateComments.push({
                    type: block ? 'Block' : 'Line',
                    value: comment,
                    start: -1,
                    end: -1,
                })
            },
        },
        comments,
    ]
}

export function parseScript(content: string): [Estree.Program, Estree.Comment[][]] {
    const [opts, comments] = scriptParseOptionsWithComments()
    return [ScriptParser.parse(content, opts), comments]
}

type InitRuntimeFunc = (funcName?: string, parentFunc?: string) => string | undefined

export class Transformer<RTCtxT = {}> {
    index: IndexTracker
    heuristic: HeuristicFunc
    content: string
    /* for when the comments are not parsed as part of the AST */
    comments: Estree.Comment[][] = []
    mstr: MagicString
    patterns: CodePattern[]
    matchUrl: UrlMatcher
    initRuntime: InitRuntimeFunc
    currentRtVar: string
    vars: () => RuntimeVars

    // state
    commentDirectives: CommentDirectives = {}
    heuristciDetails: HeuristicDetails = { file: '', scope: 'script', insideProgram: true }
    /** .start of the first statements in their respective parents, to put the runtime init before */
    realBodyStarts = new Set<number>()
    /** will be passed to decide which runtime variable to use */
    runtimeCtx: RTCtxT = {} as RTCtxT

    constructor(
        content: string,
        filename: string,
        index: IndexTracker,
        heuristic: HeuristicFunc,
        patterns: CodePattern[],
        catalogExpr: CatalogExpr,
        rtConf: RuntimeConf<RTCtxT>,
        matchUrl: UrlMatcher,
        rtBaseVars = [varNames.rt],
    ) {
        this.index = index
        this.heuristic = heuristic
        this.patterns = patterns
        this.content = content
        this.heuristciDetails.file = filename
        this.matchUrl = matchUrl
        const topLevelUseReactive =
            typeof rtConf.useReactive === 'boolean'
                ? () => rtConf.useReactive
                : {
                      nested: false,
                      file: filename,
                      ctx: this.runtimeCtx,
                  }

        const vars: Record<string, { [key in 'plain' | 'reactive']: RuntimeVars }> = {}
        // to enable the use of different runtime vars for different places, right now for svelte <script module>s
        for (const baseVar of rtBaseVars) {
            vars[baseVar] = {
                reactive: rtConf.reactive?.wrapUse && runtimeVars(rtConf.reactive.wrapUse, baseVar),
                plain: rtConf.plain?.wrapUse && runtimeVars(rtConf.plain.wrapUse, baseVar),
            }
        }
        this.currentRtVar = rtBaseVars[0]
        this.vars = () => {
            const useReactive =
                typeof rtConf.useReactive === 'boolean'
                    ? rtConf.useReactive
                    : (rtConf.useReactive({
                          funcName: this.heuristciDetails.funcName ?? undefined,
                          nested: this.heuristciDetails.funcIsNested ?? false,
                          file: filename,
                          ...this.runtimeCtx,
                      }) ?? topLevelUseReactive)
            const currentVars = vars[this.currentRtVar]
            return useReactive ? currentVars.reactive : currentVars.plain
        }
        this.initRuntime = (funcName, parentFunc) => {
            let initReactive = rtConf.initReactive({
                funcName,
                nested: parentFunc != null,
                file: filename,
                ...this.runtimeCtx,
            })
            if (initReactive == null) {
                return
            }
            if (typeof rtConf.useReactive === 'boolean') {
                initReactive = rtConf.useReactive // should be consistent
            }
            const wrapInit = initReactive ? rtConf.reactive.wrapInit : rtConf.plain.wrapInit
            const expr = initReactive ? catalogExpr.reactive : catalogExpr.plain
            return `\nconst ${this.currentRtVar} = ${wrapInit(expr)}\n`
        }
    }

    fullHeuristicDetails = (detailsBase: HeuristicDetailsBase): HeuristicDetails => {
        const details = { ...this.heuristciDetails, ...detailsBase }
        if (details.declaring == null && details.insideProgram) {
            details.declaring = 'expression'
        }
        return details
    }

    getHeuristicMessageType = (msg: Message): HeuristicResultChecked => {
        const msgStr = msg.msgStr.join('\n')
        if (!msgStr) {
            // nothing to ask
            return false
        }
        if (this.commentDirectives.forceType === false) {
            return false
        }
        const heuRes = this.heuristic(msg) ?? defaultHeuristicFuncOnly(msg) ?? 'message'
        if (this.commentDirectives.forceType == null && heuRes === 'url' && this.matchUrl(msgStr) == null) {
            return false
        }
        return this.commentDirectives.forceType || heuRes
    }

    checkHeuristic = (msgStr: string, detailsBase: HeuristicDetailsBase): [MessageType, Message] | [false, null] => {
        if (!msgStr) {
            // nothing to ask
            return [false, null]
        }
        const msg = new Message(msgStr, this.fullHeuristicDetails(detailsBase), this.commentDirectives.context)
        const heuRes = this.getHeuristicMessageType(msg)
        if (!heuRes) {
            return [false, null]
        }
        msg.type = heuRes
        return [heuRes, msg]
    }

    visitLiteral = (node: Estree.Literal, heuristicDetailsBase?: HeuristicDetailsBase): Message[] => {
        if (typeof node.value !== 'string') {
            return []
        }
        const { start, end } = node
        const [pass, msgInfo] = this.checkHeuristic(node.value, heuristicDetailsBase ?? { scope: 'script' })
        if (!pass) {
            return []
        }
        this.mstr.update(start, end, `${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})`)
        return [msgInfo]
    }

    visitArrayExpression = (node: Estree.ArrayExpression): Message[] =>
        node.elements.flatMap((elm) => (elm ? this.visit(elm) : []))

    visitSequenceExpression = (node: Estree.SequenceExpression): Message[] => node.expressions.flatMap(this.visit)

    visitObjectExpression = (node: Estree.ObjectExpression): Message[] => node.properties.flatMap(this.visit)

    visitObjectPattern = (node: Estree.ObjectPattern): Message[] => node.properties.flatMap(this.visit)

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

    visitChainExpression = (node: Estree.ChainExpression): Message[] => this.visit(node.expression)

    visitNewExpression = (node: Estree.NewExpression): Message[] => node.arguments.flatMap(this.visit)

    defaultVisitCallExpression = (node: Estree.CallExpression): Message[] => {
        const msgs = this.visit(node.callee)
        const currentCall = this.heuristciDetails.call
        this.heuristciDetails.call = this.getCalleeName(node.callee)
        for (const arg of node.arguments) {
            msgs.push(...this.visit(arg))
        }
        this.heuristciDetails.call = currentCall // restore
        return msgs
    }

    visitCallExpression = (node: Estree.CallExpression): Message[] => {
        if (node.callee.type !== 'Identifier') {
            return this.defaultVisitCallExpression(node)
        }
        const calleeName = node.callee.name
        const pattern = this.patterns.find((p) => p.name === calleeName)
        if (!pattern) {
            return this.defaultVisitCallExpression(node)
        }
        let iLastNonOther = pattern.args.length - 1 // after this no change will be made
        for (; iLastNonOther >= 0; iLastNonOther--) {
            if (pattern.args[iLastNonOther] !== 'other') {
                break
            }
        }
        const msgs: Message[] = []
        const updates: [number, number, string][] = []
        const appends: [number, string][] = []
        let lastArgEnd: number | null = null
        for (const [i, arg] of pattern.args.entries()) {
            const argVal = node.arguments[i]
            let argInsertIndex = 0 // for now
            if (argVal == null) {
                argInsertIndex = lastArgEnd ?? node.callee.end + 1
                if (lastArgEnd == null) {
                    lastArgEnd = argInsertIndex
                }
            } else {
                lastArgEnd = argVal.end
            }
            const comma = i > 0 ? ', ' : ''
            if (arg === 'other') {
                if (argVal == null && i < iLastNonOther) {
                    appends.push([argInsertIndex, `${comma}undefined`])
                }
                continue
            }
            if (arg === 'locale') {
                if (argVal) {
                    if (argVal.type !== 'Literal' || typeof argVal.value !== 'string') {
                        continue
                    }
                    updates.push([argVal.start, argVal.end, this.vars().rtLocale])
                } else {
                    appends.push([argInsertIndex, `${comma}${this.vars().rtLocale}`])
                }
                continue
            }
            if (arg === 'pluralFunc') {
                if (argVal) {
                    updates.push([argVal.start, argVal.end, this.vars().rtPlural])
                } else {
                    appends.push([argInsertIndex, `${comma}${this.vars().rtPlural}`])
                }
                continue
            }
            // message, always required
            if (argVal === null) {
                return this.defaultVisitCallExpression(node)
            }
            if (argVal.type === 'Literal') {
                if (typeof argVal.value !== 'string') {
                    return this.defaultVisitCallExpression(node)
                }
                const msgInfo = new Message(
                    argVal.value,
                    this.fullHeuristicDetails({ scope: 'script' }),
                    this.commentDirectives.context,
                )
                updates.push([argVal.start, argVal.end, `${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})`])
                msgs.push(msgInfo)
                continue
            }
            if (argVal.type === 'TemplateLiteral') {
                msgs.push(...this.visitTemplateLiteral(argVal, true))
                continue
            }
            if (argVal.type !== 'ArrayExpression') {
                return this.defaultVisitCallExpression(node)
            }
            const candidates: string[] = []
            for (const elm of argVal.elements) {
                if (!elm || elm.type !== 'Literal' || typeof elm.value !== 'string') {
                    return this.defaultVisitCallExpression(node)
                }
                candidates.push(elm.value)
            }
            // plural(num, ['Form one', 'Form two'])
            const msgInfo = new Message(
                candidates,
                this.fullHeuristicDetails({ scope: 'script' }),
                this.commentDirectives.context,
            )
            msgInfo.plural = true
            const index = this.index.get(msgInfo.toKey())
            msgs.push(msgInfo)
            updates.push([argVal.start, argVal.end, `${this.vars().rtTPlural}(${index})`])
        }
        for (const [start, end, by] of updates) {
            this.mstr.update(start, end, by)
        }
        for (const [index, insert] of appends) {
            this.mstr.appendRight(index, insert)
        }
        return msgs
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

    visitForStatement = (node: Estree.ForStatement): Message[] => {
        const msgs = this.visit(node.body)
        if (node.init) {
            msgs.push(...this.visit(node.init))
        }
        if (node.test) {
            msgs.push(...this.visit(node.test))
        }
        if (node.update) {
            msgs.push(...this.visit(node.update))
        }
        return msgs
    }

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

    defaultVisitVariableDeclarator = (node: Estree.VariableDeclarator): Message[] => {
        const atTopLevelDefn = this.heuristciDetails.insideProgram && !this.heuristciDetails.declaring
        if (!node.init) {
            return []
        }
        if (atTopLevelDefn) {
            if (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression') {
                this.heuristciDetails.declaring = 'function'
            } else {
                this.heuristciDetails.declaring = 'variable'
                if (node.init.type === 'CallExpression') {
                    this.heuristciDetails.topLevelCall = this.getCalleeName(node.init.callee)
                }
            }
        }
        const msgs = [...this.visit(node.id), ...this.visit(node.init)]
        if (atTopLevelDefn) {
            this.heuristciDetails.topLevelCall = undefined // reset
            this.heuristciDetails.declaring = undefined
        }
        return msgs
    }

    // for e.g. svelte to surrounded with $derived
    visitVariableDeclarator = this.defaultVisitVariableDeclarator

    visitVariableDeclaration = (node: Estree.VariableDeclaration): Message[] =>
        node.declarations.flatMap(this.visitVariableDeclarator)

    visitExportNamedDeclaration = (node: Estree.ExportNamedDeclaration): Message[] =>
        node.declaration ? this.visit(node.declaration) : []

    visitExportDefaultDeclaration = this.visitExportNamedDeclaration

    visitStatementsNSaveRealBodyStart = (nodes: (Estree.Statement | Estree.ModuleDeclaration)[]): Message[] => {
        const msgs: Message[] = []
        let bodyStart: number | null = null
        for (const bod of nodes) {
            let currentContent = '' // for now
            if (bodyStart == null) {
                currentContent = this.mstr.toString()
            }
            msgs.push(...this.visit(bod))
            if (bodyStart != null) {
                continue
            }
            // TODO: use deep return checks after using state passing to visitors
            if (
                this.mstr.toString() !== currentContent ||
                (bod.type === 'IfStatement' &&
                    bod.consequent.type === 'BlockStatement' &&
                    bod.consequent.body.some((n) => n.type === 'ReturnStatement'))
            ) {
                bodyStart = bod.start
            }
        }
        if (bodyStart) {
            this.realBodyStarts.add(bodyStart)
        }
        return msgs
    }

    getRealBodyStart = (nodes: (Estree.Statement | Estree.ModuleDeclaration)[]): number | undefined => {
        let nonLiteralStart: number | null = null
        for (const node of nodes) {
            if (this.realBodyStarts.has(node.start)) {
                return node.start
            }
            if (
                nonLiteralStart == null &&
                node.type !== 'ImportDeclaration' &&
                (node.type !== 'ExpressionStatement' || node.expression.type !== 'Literal')
            ) {
                nonLiteralStart = node.start
            }
        }
        return nonLiteralStart ?? nodes[0]?.start
    }

    visitFunctionBody = (node: Estree.BlockStatement | Estree.Expression, name?: string, end?: number): Message[] => {
        const prevFuncDef = this.heuristciDetails.funcName
        const prevFuncNested = this.heuristciDetails.funcIsNested
        this.heuristciDetails.funcName = name
        this.heuristciDetails.funcIsNested = name != null && prevFuncDef != null
        const msgs = this.visit(node)
        if (msgs.length > 0) {
            const initRuntime = this.initRuntime(this.heuristciDetails.funcName, prevFuncDef ?? undefined)
            if (initRuntime) {
                if (node.type === 'BlockStatement') {
                    this.mstr.prependLeft(this.getRealBodyStart(node.body) ?? node.start, initRuntime)
                } else {
                    // get real start if surrounded by parens
                    let start = node.start - 1
                    for (; start > 0; start--) {
                        const char = this.content[start]
                        if (char === '(') {
                            break
                        }
                        if (!/\s/.test(char)) {
                            start = node.start
                            break
                        }
                    }
                    this.mstr.prependLeft(start, `{${initRuntime}return `)
                    this.mstr.appendRight(end ?? node.end, '\n}')
                }
            }
        }
        this.heuristciDetails.funcIsNested = prevFuncNested
        this.heuristciDetails.funcName = prevFuncDef
        return msgs
    }

    visitFunctionDeclaration = (node: Estree.FunctionDeclaration): Message[] => {
        const declaring = this.heuristciDetails.declaring
        this.heuristciDetails.declaring = 'function'
        const msgs = this.visitFunctionBody(node.body, node.id?.name ?? '')
        this.heuristciDetails.declaring = declaring
        return msgs
    }

    visitArrowFunctionExpression = (node: Estree.ArrowFunctionExpression): Message[] =>
        this.visitFunctionBody(node.body, '', node.end)

    visitFunctionExpression = (node: Estree.FunctionExpression): Message[] => this.visitFunctionBody(node.body, '')

    visitBlockStatement = (node: Estree.BlockStatement): Message[] => this.visitStatementsNSaveRealBodyStart(node.body)

    visitReturnStatement = (node: Estree.ReturnStatement): Message[] => (node.argument ? this.visit(node.argument) : [])

    visitIfStatement = (node: Estree.IfStatement): Message[] => {
        const msgs = this.visit(node.test)
        msgs.push(...this.visit(node.consequent))
        if (node.alternate) {
            msgs.push(...this.visit(node.alternate))
        }
        return msgs
    }

    visitClassDeclaration = (node: Estree.ClassDeclaration): Message[] => {
        const msgs: Message[] = []
        const prevDecl = this.heuristciDetails.declaring
        this.heuristciDetails.declaring = 'class'
        for (const body of node.body.body) {
            if (body.type === 'MethodDefinition') {
                msgs.push(...this.visit(body.key))
                const methodName = this.content.slice(body.key.start, body.key.end)
                if (body.value.type === 'FunctionExpression') {
                    // and not e.g. TSDeclareMethod
                    msgs.push(...this.visitFunctionBody(body.value.body, `${node.id.name}.${methodName}`))
                }
            } else if (body.type === 'StaticBlock') {
                const currentFuncDef = this.heuristciDetails.funcName
                this.heuristciDetails.funcName = `${node.id.name}.[static]`
                msgs.push(...body.body.flatMap(this.visit))
                this.heuristciDetails.funcName = currentFuncDef // restore
            }
        }
        this.heuristciDetails.declaring = prevDecl // restore
        return msgs
    }

    checkHeuristicTemplateLiteral = (
        node: Estree.TemplateLiteral,
        heurDetails?: HeuristicDetailsBase,
    ): HeuristicResultChecked => {
        let heurTxt = ''
        for (const quasi of node.quasis) {
            heurTxt += quasi.value.cooked ?? ''
            if (!quasi.tail) {
                heurTxt += '#'
            }
        }
        heurTxt = heurTxt.trim()
        const [pass] = this.checkHeuristic(heurTxt, heurDetails ?? { scope: 'script' })
        return pass
    }

    visitTemplateLiteralQuasis = (node: Estree.TemplateLiteral, msgTyp: MessageType): [number, Message[]] => {
        const msgs: Message[] = []
        let msgStr = node.quasis[0].value?.cooked ?? ''
        const comments: string[] = []
        for (const [i, expr] of node.expressions.entries()) {
            msgs.push(...this.visit(expr))
            const quasi = node.quasis[i + 1]
            const placeholder = `{${i}}`
            msgStr += `${placeholder}${quasi.value.cooked}`
            comments.push(`placeholder ${placeholder}: ${this.content.slice(expr.start, expr.end)}`)
            const { start, end } = quasi
            this.mstr.remove(start - 1, end)
            if (i + 1 === node.expressions.length) {
                continue
            }
            this.mstr.update(end, end + 2, ', ')
        }
        const msgInfo = new Message(
            msgStr,
            this.fullHeuristicDetails({ scope: 'script' }),
            this.commentDirectives.context,
        )
        msgInfo.type = msgTyp
        msgInfo.comments = comments
        const index = this.index.get(msgInfo.toKey())
        msgs.push(msgInfo)
        return [index, msgs]
    }

    visitTemplateLiteral = (
        node: Estree.TemplateLiteral,
        heurDetails: HeuristicDetailsBase | boolean = false,
    ): Message[] => {
        let msgTyp: MessageType = 'message'
        if (heurDetails !== true) {
            const heuRes = this.checkHeuristicTemplateLiteral(
                node,
                typeof heurDetails === 'boolean' ? undefined : heurDetails,
            )
            if (!heuRes) {
                return node.expressions.flatMap(this.visit)
            }
            msgTyp = heuRes
        }
        const [index, msgs] = this.visitTemplateLiteralQuasis(node, msgTyp)
        const { start: start0, end: end0 } = node.quasis[0]
        let begin = `${this.vars().rtTrans}(${index}`
        let end = ')'
        if (node.expressions.length) {
            begin += ', ['
            end = ']' + end
            this.mstr.update(start0 - 1, end0 + 2, begin)
            this.mstr.update(node.end - 1, node.end, end)
        } else {
            this.mstr.update(start0 - 1, end0 + 1, begin + end)
        }
        return msgs
    }

    visitTaggedTemplateExpression = (node: Estree.TaggedTemplateExpression): Message[] => {
        const prevCall = this.heuristciDetails.call
        this.heuristciDetails.call = this.getCalleeName(node.tag)
        let msgs: Message[] = []
        const heuRes = this.checkHeuristicTemplateLiteral(node.quasi)
        if (heuRes) {
            const [index, msgsNew] = this.visitTemplateLiteralQuasis(node.quasi, heuRes)
            msgs = msgsNew
            this.mstr.appendRight(node.tag.start, `${this.vars().rtTransTag}(`)
            const { start, end, expressions } = node.quasi
            if (expressions.length > 0) {
                this.mstr.update(start, expressions[0].start, `, ${index}, [`)
                this.mstr.update(end - 1, end, `])`)
            } else {
                this.mstr.remove(start, start + 1)
                this.mstr.update(start, end, `, ${index})`)
            }
        }
        this.heuristciDetails.call = prevCall
        return msgs
    }

    visitSwitchStatement = (node: Estree.SwitchStatement): Message[] =>
        node.cases.flatMap((c) => c.consequent.map(this.visit)).flat()

    visitTryStatement = (node: Estree.TryStatement): Message[] => {
        const msgs = this.visit(node.block)
        if (node.handler) {
            msgs.push(...this.visit(node.handler.body))
        }
        if (node.finalizer) {
            msgs.push(...this.visit(node.finalizer))
        }
        return msgs
    }

    visitTSAsExpression = (node: { expression: Estree.AnyNode }): Message[] => this.visit(node.expression)

    visitTSTypeAssertion = (node: { expression: Estree.AnyNode }): Message[] => this.visit(node.expression)

    visitProgram = (node: Estree.Program): Message[] => {
        this.heuristciDetails.insideProgram = true
        const msgs = this.visitStatementsNSaveRealBodyStart(node.body)
        this.heuristciDetails.insideProgram = false
        return msgs
    }

    visitWithCommentDirectives = (node: Estree.AnyNode, func: Function) => {
        const commentDirectives = { ...this.commentDirectives }
        // for estree
        const comments = this.comments[node.start]
        // @ts-expect-error
        for (const comment of node.leadingComments ?? comments ?? []) {
            updateCommentDirectives(comment.value.trim(), this.commentDirectives)
        }
        if (this.commentDirectives.ignoreFile) {
            return []
        }
        const res = func()
        for (const key in this.commentDirectives) {
            this.commentDirectives[key] = commentDirectives[key] // restore
        }
        return res
    }

    visit = (node: Estree.AnyNode): Message[] =>
        this.visitWithCommentDirectives(node, () => {
            if (this.commentDirectives.forceType === false) {
                return []
            }
            let msgs = []
            const visitor = this[`visit${node.type}`]
            if (visitor != null) {
                msgs = visitor(node)
                // } else {
                //     console.log(node)
            }
            return msgs
        })

    finalize = (msgs: Message[], hmrHeaderIndex: number, additionalHeader = ''): TransformOutput => ({
        msgs,
        output: (header) => {
            this.mstr.prependRight(hmrHeaderIndex, `\n${header}\n${additionalHeader}\n`)
            return {
                code: this.mstr.toString(),
                map: this.mstr.generateMap(),
            }
        },
    })

    transform = (): TransformOutput => {
        const [ast, comments] = parseScript(this.content)
        this.comments = comments
        this.mstr = new MagicString(this.content)
        return this.finalize(this.visit(ast), this.getRealBodyStart(ast.body) ?? 0)
    }
}
