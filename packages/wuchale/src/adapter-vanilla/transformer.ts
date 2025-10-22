// $$ cd .. && npm run test

import MagicString from "magic-string"
import type * as Estree from "acorn"
import { Parser } from 'acorn'
import { tsPlugin } from '@sveltejs/acorn-typescript'
import { defaultHeuristicFuncOnly, Message } from '../adapters.js'
import type {
    HeuristicDetailsBase,
    HeuristicFunc,
    IndexTracker,
    ScriptDeclType,
    TransformOutput,
    HeuristicDetails,
    RuntimeConf,
    CatalogExpr,
    CodePattern,
} from "../adapters.js"
import { processCommentDirectives, runtimeVars, varNames, type RuntimeVars, type CommentDirectives } from "../adapter-utils/index.js"

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

type InitRuntimeFunc = (file: string, funcName: string, parentFunc: string, additional: object) => string

export class Transformer {

    index: IndexTracker
    heuristic: HeuristicFunc
    content: string
    /* for when the comments are not parsed as part of the AST */
    comments: Estree.Comment[][] = []
    filename: string
    mstr: MagicString
    patterns: CodePattern[]
    initRuntime: InitRuntimeFunc
    currentRtVar: string
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

    constructor(content: string, filename: string, index: IndexTracker, heuristic: HeuristicFunc, patterns: CodePattern[], catalogExpr: CatalogExpr, rtConf: RuntimeConf, rtBaseVars = [varNames.rt]) {
        this.index = index
        this.heuristic = heuristic
        this.patterns = patterns
        this.content = content
        this.filename = filename
        const topLevelUseReactive = rtConf.useReactive({
            funcName: null,
            nested: false,
            file: filename,
            additional: this.additionalState,
        })

        const vars: Record<string, {[key in 'plain' | 'reactive']: RuntimeVars}> = {}
        // to enable the use of different runtime vars for different places, right now for svelte <script module>s
        for (const baseVar of rtBaseVars) {
            vars[baseVar] = {
                reactive: rtConf.reactive?.wrapUse && runtimeVars(rtConf.reactive.wrapUse, baseVar),
                plain: rtConf.plain?.wrapUse && runtimeVars(rtConf.plain.wrapUse, baseVar),
            }
        }
        this.currentRtVar = rtBaseVars[0]
        this.vars = () => {
            const useReactive = rtConf.useReactive({
                funcName: this.currentFuncDef,
                nested: this.currentFuncNested,
                file: filename,
                additional: this.additionalState,
            }) ?? topLevelUseReactive
            const currentVars = vars[this.currentRtVar]
            return useReactive.use ? currentVars.reactive : currentVars.plain
        }
        this.initRuntime = (file, funcName, parentFunc, additional) => {
            const useReactive = rtConf.useReactive({funcName, nested: parentFunc != null, file, additional})
            if (useReactive.init == null) {
                return
            }
            const wrapInit = useReactive.init ? rtConf.reactive.wrapInit : rtConf.plain.wrapInit
            const expr = useReactive.init ? catalogExpr.reactive : catalogExpr.plain
            const runtimeExpr = `${varNames.rtWrap}(${expr})`
            return `\nconst ${this.currentRtVar} = ${wrapInit(runtimeExpr)}\n`
        }
    }

    fullHeuristicDetails = (detailsBase: HeuristicDetailsBase): HeuristicDetails => {
        const details: HeuristicDetails = {
            file: this.filename,
            call: this.currentCall,
            declaring: this.declaring,
            funcName: this.currentFuncDef,
            topLevelCall: this.currentTopLevelCall,
            ...detailsBase
        }
        if (details.declaring == null && this.insideProgram) {
            details.declaring = 'expression'
        }
        return details
    }

    checkHeuristicBool = (msg: Message) => {
        const msgStr = msg.msgStr.join('\n')
        if (!msgStr) {
            // nothing to ask
            return false
        }
        let extract = this.commentDirectives.forceInclude
        if (extract == null) {
            extract = this.heuristic(msg) ?? defaultHeuristicFuncOnly(msg) ?? true
        }
        return extract
    }

    checkHeuristic = (msgStr: string, detailsBase: HeuristicDetailsBase): [boolean, Message] => {
        if (!msgStr) {
            // nothing to ask
            return [false, null]
        }
        const msg = new Message(msgStr, this.fullHeuristicDetails(detailsBase), this.commentDirectives.context)
        return [this.checkHeuristicBool(msg), msg]
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

    visitSequenceExpression = (node: Estree.SequenceExpression): Message[] => node.expressions.map(this.visit).flat()

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

    visitChainExpression = (node: Estree.ChainExpression): Message[] => this.visit(node.expression)

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
        if (node.callee.type !== 'Identifier') {
            return this.defaultVisitCallExpression(node)
        }
        const calleeName = node.callee.name
        const pattern = this.patterns.find(p => p.name === calleeName)
        if (!pattern) {
            return this.defaultVisitCallExpression(node)
        }
        const msgs: Message[] = []
        let lastArgEnd: number
        for (const [i, arg] of pattern.args.entries()) {
            const argVal = node.arguments[i]
            let argInsertIndex: number
            if (argVal == null) {
                if (lastArgEnd == null) {
                    return this.defaultVisitCallExpression(node)
                }
                argInsertIndex = lastArgEnd
            } else {
                lastArgEnd = argVal.end
            }
            if (arg === 'other') {
                continue
            }
            if (arg === 'pluralFunc') {
                if (argVal) {
                    this.mstr.update(argVal.start, argVal.end, this.vars().rtPlural)
                } else {
                    this.mstr.appendRight(argInsertIndex, `, ${this.vars().rtPlural}`)
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
                const msgInfo = new Message(argVal.value, this.fullHeuristicDetails({scope: 'script'}), this.commentDirectives.context)
                this.mstr.update(argVal.start, argVal.end, `${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})`)
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
            const candidates = []
            for (const elm of argVal.elements) {
                if (elm.type !== 'Literal' || typeof elm.value !== 'string') {
                    return this.defaultVisitCallExpression(node)
                }
                candidates.push(elm.value)
            }
            // plural(num, ['Form one', 'Form two'])
            const msgInfo = new Message(candidates, this.fullHeuristicDetails({scope: 'script'}), this.commentDirectives.context)
            msgInfo.plural = true
            const index = this.index.get(msgInfo.toKey())
            msgs.push(msgInfo)
            this.mstr.update(argVal.start, argVal.end, `${this.vars().rtTPlural}(${index})`)
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

    defaultVisitVariableDeclarator = (node: Estree.VariableDeclarator): Message[] => {
        let atTopLevelDefn = this.insideProgram && !this.declaring
        if (!node.init) {
            return []
        }
        if (atTopLevelDefn) {
            if (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression') {
                this.declaring = 'function'
            } else {
                this.declaring = 'variable'
                if (node.init.type === 'CallExpression') {
                    this.currentTopLevelCall = this.getCalleeName(node.init.callee)
                }
            }
        }
        const msgs = [...this.visit(node.id), ...this.visit(node.init)]
        if (atTopLevelDefn) {
            this.currentTopLevelCall = null // reset
            this.declaring = null
        }
        return msgs
    }

    // for e.g. svelte to surrounded with $derived
    visitVariableDeclarator = this.defaultVisitVariableDeclarator

    visitVariableDeclaration = (node: Estree.VariableDeclaration): Message[] => node.declarations.map(this.visitVariableDeclarator).flat()

    visitExportNamedDeclaration = (node: Estree.ExportNamedDeclaration): Message[] => node.declaration ? this.visit(node.declaration) : []

    visitExportDefaultDeclaration = this.visitExportNamedDeclaration

    getRealBodyStart = (nodes: (Estree.Statement | Estree.ModuleDeclaration)[]): number | undefined => {
        for (const node of nodes) {
            if (node.type === 'ExpressionStatement' && node.expression.type === 'Literal') {
                continue
            }
            return node.start
        }
        return nodes[0]?.start
    }

    visitFunctionBody = (node: Estree.BlockStatement | Estree.Expression, name: string | null, end?: number): Message[] => {
        const prevFuncDef = this.currentFuncDef
        const prevFuncNested = this.currentFuncNested
        this.currentFuncDef = name
        this.currentFuncNested = name != null && prevFuncDef != null
        const msgs = this.visit(node)
        if (msgs.length > 0) {
            const initRuntime = this.initRuntime(this.filename, this.currentFuncDef, prevFuncDef, this.additionalState)
            if (initRuntime) {
                if (node.type === 'BlockStatement') {
                    this.mstr.prependLeft(
                        this.getRealBodyStart(node.body) ?? node.start,
                        initRuntime,
                    )
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

    visitArrowFunctionExpression = (node: Estree.ArrowFunctionExpression): Message[] => this.visitFunctionBody(node.body, '', node.end)

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

    visitClassDeclaration = (node: Estree.ClassDeclaration): Message[] => {
        const msgs: Message[] = []
        const prevDecl = this.declaring
        this.declaring = 'class'
        for (const body of node.body.body) {
            if (body.type === 'MethodDefinition') {
                msgs.push(...this.visit(body.key))
                const methodName = this.content.slice(body.key.start, body.key.end)
                msgs.push(...this.visitFunctionBody(body.value.body, `${node.id.name}.${methodName}`))
            } else if (body.type === 'StaticBlock') {
                const currentFuncDef = this.currentFuncDef
                this.currentFuncDef = `${node.id.name}.[static]`
                msgs.push(...body.body.map(this.visit).flat())
                this.currentFuncDef = currentFuncDef // restore
            }
        }
        this.declaring = prevDecl // restore
        return msgs
    }

    checkHeuristicTemplateLiteral = (node: Estree.TemplateLiteral): boolean => {
        let heurTxt = ''
        for (const quasi of node.quasis) {
            heurTxt += quasi.value.cooked ?? ''
            if (!quasi.tail) {
                heurTxt += '#'
            }
        }
        heurTxt = heurTxt.trim()
        const [pass] = this.checkHeuristic(heurTxt, { scope: 'script' })
        return pass
    }

    visitTemplateLiteralQuasis = (node: Estree.TemplateLiteral): [number, Message[]] => {
        const msgs = []
        let msgStr = node.quasis[0].value?.cooked ?? ''
        const comments = []
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
        const msgInfo = new Message(msgStr, this.fullHeuristicDetails({scope: 'script'}), this.commentDirectives.context)
        msgInfo.comments = comments
        const index = this.index.get(msgInfo.toKey())
        msgs.push(msgInfo)
        return [index, msgs]
    }

    visitTemplateLiteral = (node: Estree.TemplateLiteral, ignoreHeuristic = false): Message[] => {
        if (!ignoreHeuristic) {
            if (!this.checkHeuristicTemplateLiteral(node)) {
                return node.expressions.map(this.visit).flat()
            }
        }
        const [index, msgs] = this.visitTemplateLiteralQuasis(node)
        const {start: start0, end: end0} = node.quasis[0]
        let begin = `${this.vars().rtTrans}(${index}`
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
        return msgs
    }

    visitTaggedTemplateExpression = (node: Estree.TaggedTemplateExpression): Message[] => {
        const prevCall = this.currentCall
        this.currentCall = this.getCalleeName(node.tag)
        let msgs = []
        if (this.checkHeuristicTemplateLiteral(node.quasi)) {
            const [index, msgsNew] = this.visitTemplateLiteralQuasis(node.quasi)
            msgs = msgsNew
            this.mstr.appendRight(node.tag.start, `${this.vars().rtTransTag}(`)
            const {start, end, expressions} = node.quasi
            if (expressions.length > 0) {
                this.mstr.update(start, expressions[0].start, `, ${index}, [`)
                this.mstr.update(end - 1, end, `])`)
            } else {
                this.mstr.remove(start, start + 1)
                this.mstr.update(start, end, `, ${index})`)
            }
        }
        this.currentCall = prevCall
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

    visit = (node: Estree.AnyNode): Message[] => {
        // for estree
        const commentDirectives = { ...this.commentDirectives }
        const comments = this.comments[node.start]
        // @ts-expect-error
        for (const comment of node.leadingComments ?? comments ?? []) {
            this.commentDirectives = processCommentDirectives(comment.value.trim(), this.commentDirectives)
        }
        if (this.commentDirectives.ignoreFile) {
            return []
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

    finalize = (msgs: Message[], hmrHeaderIndex: number, additionalHeader = ''): TransformOutput => ({
        msgs,
        output: header => {
            this.mstr.prependRight(hmrHeaderIndex, `\n${header}\n${additionalHeader}\n`)
            return {
                code: this.mstr.toString(),
                map: this.mstr.generateMap(),
            }
        }
    })

    transform = (): TransformOutput => {
        const [ast, comments] = parseScript(this.content)
        this.comments = comments
        this.mstr = new MagicString(this.content)
        return this.finalize(this.visit(ast), this.getRealBodyStart(ast.body) ?? 0)
    }
}
