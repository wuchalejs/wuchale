// $$ cd .. && npm run test

import { tsPlugin } from '@sveltejs/acorn-typescript'
import type * as Estree from 'acorn'
import { Parser } from 'acorn'
import MagicString from 'magic-string'
import {
    type CommentDirectives,
    type RuntimeVars,
    restoreCommentDirectives,
    runtimeVars,
    updateCommentDirectives,
    varNames,
} from '../adapter-utils/index.js'
import type { CodePattern, IndexTracker, RuntimeConf, TransformCtx, TransformOutput, UrlMatcher } from '../adapters.js'
import { getKey } from '../adapters.js'
import type { HeuristicFunc, HeuristicResultChecked, Scope, TextType } from '../text.js'
import { defaultHeuristicFuncOnly, newText, type Text } from '../text.js'
import InertVisitors from './inertvisitors.js'

export const scriptParseOptions: Estree.Options = {
    sourceType: 'module',
    ecmaVersion: 'latest',
    locations: true,
    // relaxed because checking correctness is not the focus here
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowSuperOutsideMethod: true,
    allowImportExportEverywhere: true,
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

export class Transformer extends InertVisitors {
    index: IndexTracker
    heuristic: HeuristicFunc
    content: string
    /* for when the comments are not parsed as part of the AST */
    comments: Estree.Comment[][] = []
    mstr: MagicString
    patterns: CodePattern[]
    matchUrl: UrlMatcher
    initReactive: () => ReturnType<RuntimeConf['initReactive']>
    initRuntime: InitRuntimeFunc
    currentRtVar: string
    vars: () => RuntimeVars

    // state
    commentDirectives: CommentDirectives = {}
    filename: string
    scopePath: Scope[] = []
    /** .start of the first statements in their respective parents, to put the runtime init before */
    realBodyStarts = new Set<number>()
    patternMatchMods = 0 // for realBodyStarts
    /** will be passed to decide which runtime variable to use */
    runtimeCtx = {}

    constructor(
        ctx: TransformCtx,
        heuristic: HeuristicFunc,
        patterns: CodePattern[],
        rtConf: RuntimeConf,
        rtBaseVars = [varNames.rt],
    ) {
        super()
        this.index = ctx.index
        this.content = ctx.content
        this.matchUrl = ctx.matchUrl
        this.filename = ctx.filename
        this.heuristic = heuristic
        this.patterns = patterns
        this.mstr = new MagicString(this.content)
        const topLevelUseReactive =
            typeof rtConf.useReactive === 'boolean'
                ? rtConf.useReactive
                : (rtConf.useReactive(this.scopePath, ctx.filename, this.runtimeCtx) ?? false)

        const vars: Record<string, { [key in 'plain' | 'reactive']: RuntimeVars }> = {}
        // to enable the use of different runtime vars for different places, right now for svelte <script module>s
        for (const baseVar of rtBaseVars) {
            vars[baseVar] = {
                reactive: runtimeVars(rtConf.reactive.wrapUse, baseVar),
                plain: runtimeVars(rtConf.plain.wrapUse, baseVar),
            }
        }
        this.currentRtVar = rtBaseVars[0]!
        this.vars = () => {
            const useReactive =
                typeof rtConf.useReactive === 'boolean'
                    ? rtConf.useReactive
                    : (rtConf.useReactive(this.scopePath, ctx.filename, this.runtimeCtx) ?? topLevelUseReactive)
            const currentVars = vars[this.currentRtVar]!
            return useReactive ? currentVars.reactive : currentVars.plain
        }
        this.initReactive = () => rtConf.initReactive(this.scopePath, ctx.filename, this.runtimeCtx)
        this.initRuntime = () => {
            let initReactive = this.initReactive()
            if (initReactive == null) {
                return
            }
            if (typeof rtConf.useReactive === 'boolean') {
                initReactive = rtConf.useReactive // should be consistent
            }
            const wrapInit = initReactive ? rtConf.reactive.wrapInit : rtConf.plain.wrapInit
            const expr = initReactive ? ctx.expr.reactive : ctx.expr.plain
            return `\nconst ${this.currentRtVar} = ${wrapInit(expr)};\n`
        }
    }

    getHeuristicMessageType(txt: Text): HeuristicResultChecked {
        const body0 = txt.body[0]
        if (!body0) {
            // nothing to ask
            return false
        }
        if (this.commentDirectives.forceType === false) {
            return false
        }
        const heuRes = this.heuristic(txt, this.filename) ?? defaultHeuristicFuncOnly(txt, this.filename) ?? 'message'
        if (this.commentDirectives.forceType == null && heuRes === 'url' && this.matchUrl(body0) == null) {
            return false
        }
        return this.commentDirectives.forceType || heuRes
    }

    checkHeuristicAllowNew(body: string): [TextType, Text] | [false, null] {
        if (!body) {
            // nothing to ask
            return [false, null]
        }
        const txt = newText({
            body: [body],
            path: this.scopePath,
            context: this.commentDirectives.context,
        })
        const heuRes = this.getHeuristicMessageType(txt)
        // not allowed here, or txt is new but new txts are not allowed
        if (!heuRes || !this.index.has(getKey(txt.body, txt.context))) {
            return [false, null]
        }
        txt.type = heuRes
        return [heuRes, txt]
    }

    inScope<T>(scope: Scope, fn: () => T) {
        this.scopePath.push(scope)
        const ret = fn()
        this.scopePath.pop()
        return ret
    }

    inScopeVisit(scope: Scope, node: Estree.AnyNode): Text[] {
        return this.inScope(scope, () => this.visit(node))
    }

    literalRepl(txt: Text) {
        const vars = this.vars()
        const indexKey = getKey(txt.body, txt.context)
        const repl = `${vars.rtTrans}(${this.index.get(indexKey)})`
        if (txt.type !== 'url') {
            return repl
        }
        return `${varNames.urlLocalize}(${repl}, ${vars.rtLocale})`
    }

    visitLiteral(node: Estree.Literal): Text[] {
        if (typeof node.value !== 'string') {
            return []
        }
        const { start, end } = node
        const [pass, msgInfo] = this.checkHeuristicAllowNew(node.value)
        if (!pass) {
            return []
        }
        this.mstr.update(start, end, this.literalRepl(msgInfo))
        return [msgInfo]
    }

    visitArrayExpression(node: Estree.ArrayExpression): Text[] {
        return node.elements.flatMap(elm => (elm ? this.visit(elm) : []))
    }

    visitSequenceExpression(node: Estree.SequenceExpression): Text[] {
        return node.expressions.flatMap(n => this.visit(n))
    }

    visitObjectExpression(node: Estree.ObjectExpression): Text[] {
        return node.properties.flatMap(n => this.visit(n))
    }

    visitObjectPattern(node: Estree.ObjectPattern): Text[] {
        return node.properties.flatMap(n => this.visit(n))
    }

    visitRestElement(node: Estree.RestElement): Text[] {
        return this.visit(node.argument)
    }

    visitProperty(node: Estree.Property): Text[] {
        const txts = this.visit(node.key)
        let keyName = '[]'
        let keyIsLiteral = false
        if (node.key.type === 'Identifier') {
            keyName = node.key.name
        } else if (node.key.type === 'Literal' && typeof node.key.value === 'string') {
            keyIsLiteral = true
            keyName = node.key.value
        }
        if (txts.length && keyIsLiteral && !node.computed) {
            this.mstr.appendRight(node.key.start, '[')
            this.mstr.appendLeft(node.key.end, ']')
        }
        txts.push(...this.inScopeVisit({ type: 'property', name: keyName }, node.value))
        return txts
    }

    visitSpreadElement(node: Estree.SpreadElement): Text[] {
        return this.visit(node.argument)
    }

    visitMemberExpression(node: Estree.MemberExpression): Text[] {
        return [...this.visit(node.object), ...this.visit(node.property)]
    }

    visitChainExpression(node: Estree.ChainExpression): Text[] {
        return this.visit(node.expression)
    }

    visitNewExpression(node: Estree.NewExpression): Text[] {
        return this.inScope({ type: 'call', kind: 'new', name: this.getCalleeName(node.callee) }, () =>
            node.arguments.flatMap(n => this.visit(n)),
        )
    }

    defaultVisitCallExpression(node: Estree.CallExpression): Text[] {
        const txts = this.visit(node.callee)
        this.inScope({ type: 'call', kind: 'function', name: this.getCalleeName(node.callee) }, () => {
            for (const arg of node.arguments) {
                txts.push(...this.visit(arg))
            }
        })
        return txts
    }

    visitCallExpression(node: Estree.CallExpression): Text[] {
        if (node.callee.type !== 'Identifier') {
            return this.defaultVisitCallExpression(node)
        }
        const calleeName = node.callee.name
        const pattern = this.patterns.find(p => p.name === calleeName)
        if (!pattern) {
            return this.defaultVisitCallExpression(node)
        }
        let iLastNonOther = pattern.args.length - 1 // after this no change will be made
        for (; iLastNonOther >= 0; iLastNonOther--) {
            if (pattern.args[iLastNonOther] !== 'other') {
                break
            }
        }
        const txts: Text[] = []
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
            if (argVal == null) {
                return this.defaultVisitCallExpression(node)
            }
            if (argVal.type === 'Literal') {
                if (typeof argVal.value !== 'string') {
                    return this.defaultVisitCallExpression(node)
                }
                const msgInfo = newText({
                    body: [argVal.value],
                    path: this.scopePath,
                    context: this.commentDirectives.context,
                })
                updates.push([argVal.start, argVal.end, this.literalRepl(msgInfo)])
                txts.push(msgInfo)
                continue
            }
            if (argVal.type === 'TemplateLiteral') {
                txts.push(...this.visitTemplateLiteral(argVal, true))
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
            const txt = newText({
                body: candidates,
                path: this.scopePath,
                context: this.commentDirectives.context,
            })
            const index = this.index.get(getKey(txt.body, txt.context))
            txts.push(txt)
            updates.push([argVal.start, argVal.end, `${this.vars().rtTPlural}(${index})`])
        }
        for (const [start, end, by] of updates) {
            this.mstr.update(start, end, by)
            this.patternMatchMods++
        }
        for (const [index, insert] of appends) {
            this.mstr.appendRight(index, insert)
            this.patternMatchMods++
        }
        return txts
    }

    visitBinaryExpression(node: Estree.BinaryExpression): Text[] {
        return [...this.visit(node.left), ...this.visit(node.right)]
    }

    visitConditionalExpression(node: Estree.ConditionalExpression): Text[] {
        return [...this.visit(node.test), ...this.visit(node.consequent), ...this.visit(node.alternate)]
    }

    visitUnaryExpression(node: Estree.UnaryExpression): Text[] {
        return this.visit(node.argument)
    }

    visitLogicalExpression(node: Estree.LogicalExpression): Text[] {
        return [...this.visit(node.left), ...this.visit(node.right)]
    }

    visitAwaitExpression(node: Estree.AwaitExpression): Text[] {
        return this.visit(node.argument)
    }

    visitAssignmentExpression(node: Estree.AssignmentExpression) {
        return [...this.visit(node.left), ...this.visit(node.right)]
    }

    visitAssignmentPattern(node: Estree.AssignmentPattern): Text[] {
        return [...this.visit(node.left), ...this.visit(node.right)]
    }

    visitForOfStatement(node: Estree.ForOfStatement): Text[] {
        return [...this.visit(node.left), ...this.visit(node.right), ...this.visit(node.body)]
    }

    visitForInStatement(node: Estree.ForInStatement): Text[] {
        return [...this.visit(node.left), ...this.visit(node.right), ...this.visit(node.body)]
    }

    visitForStatement(node: Estree.ForStatement): Text[] {
        const txts = this.visit(node.body)
        if (node.init) {
            txts.push(...this.visit(node.init))
        }
        if (node.test) {
            txts.push(...this.visit(node.test))
        }
        if (node.update) {
            txts.push(...this.visit(node.update))
        }
        return txts
    }

    getMemberChainName(node: Estree.MemberExpression): string {
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

    getCalleeName(callee: Estree.Expression | Estree.Super): string {
        if (callee.type === 'Identifier') {
            return callee.name
        }
        if (callee.type === 'MemberExpression') {
            return this.getMemberChainName(callee)
        }
        return `[${callee.type}]`
    }

    visitExpressionStatement(node: Estree.ExpressionStatement): Text[] {
        return this.inScopeVisit({ type: 'expression' }, node.expression)
    }

    getAssignmentNames(id: Estree.Pattern | Estree.AssignmentProperty) {
        let names: string[] = []
        if (id.type === 'Identifier') {
            names.push(id.name)
        } else if (id.type === 'ArrayPattern') {
            names = id.elements.filter(n => n !== null).flatMap(this.getAssignmentNames)
        } else if (id.type === 'ObjectPattern') {
            names = id.properties.flatMap(this.getAssignmentNames)
        } else if (id.type === 'RestElement') {
            names = this.getAssignmentNames(id.argument)
        } else if (id.type === 'AssignmentPattern') {
            names = this.getAssignmentNames(id.left)
        }
        return names
    }

    // for e.g. svelte to surrounded with $derived
    visitVariableDeclarator(node: Estree.VariableDeclarator) {
        if (!node.init) {
            return []
        }
        const txts = this.inScopeVisit({ type: 'assignment', left: true }, node.id)
        txts.push(
            ...this.inScopeVisit(
                { type: 'assignment', left: false, targets: this.getAssignmentNames(node.id) },
                node.init,
            ),
        )
        return txts
    }

    visitVariableDeclaration(node: Estree.VariableDeclaration): Text[] {
        return node.declarations.flatMap(n => this.visitVariableDeclarator(n))
    }

    visitExportNamedDeclaration(node: Estree.ExportNamedDeclaration | Estree.ExportDefaultDeclaration): Text[] {
        if (!node.declaration) {
            return []
        }
        return this.inScopeVisit({ type: 'export' }, node.declaration)
    }

    visitExportDefaultDeclaration(node: Estree.ExportDefaultDeclaration) {
        return this.inScopeVisit({ type: 'export' }, node)
    }

    hasReturn(node: Estree.AnyNode | Estree.AnyNode[]): boolean {
        if (!node || typeof node !== 'object') {
            return false
        }
        if (Array.isArray(node)) {
            return node.some(child => this.hasReturn(child))
        }
        if (
            node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression'
        ) {
            return false
        }
        if (node.type === 'ReturnStatement') {
            return true
        }
        return Object.values(node).some(value => this.hasReturn(value))
    }

    #updateBodyStart(bodyStart: number | null, newBodyStart: number | undefined) {
        if (newBodyStart == null) {
            return bodyStart
        }
        if (bodyStart == null) {
            return newBodyStart
        }
        return bodyStart < newBodyStart ? bodyStart : newBodyStart
    }

    visitStatementsNSaveRealBodyStart(nodes: (Estree.Statement | Estree.ModuleDeclaration)[]): Text[] {
        // the runtime should be initialized:
        // - before any extracted txts and function pattern match modifications: to make it available
        // - before any return statement: to respect react hooks requirement of always calling the same
        // - after any function calls: to handle the case where one of them is loading the catalogs
        // - but before hoited function calls of the ones down below: to make it available at call time
        const txts: Text[] = []
        let bodyStart: number | null = null
        const firstCalls = new Map<string, number>()
        for (const bod of nodes) {
            const prevPatternMods = this.patternMatchMods
            const prevMsgsLen = txts.length
            txts.push(...this.visit(bod))
            // get bodyStart
            if (bod.type === 'ExpressionStatement') {
                if (bod.expression.type === 'CallExpression') {
                    const name = this.getCalleeName(bod.expression.callee)
                    if (!firstCalls.has(name)) {
                        firstCalls.set(name, bod.start)
                    }
                }
            } else if (bod.type === 'FunctionDeclaration') {
                bodyStart = this.#updateBodyStart(bodyStart, firstCalls.get(bod.id.name))
            } else if (bod.type === 'VariableDeclaration') {
                for (const decl of bod.declarations) {
                    if (decl.id.type === 'Identifier' || decl.id.type === 'MemberExpression') {
                        bodyStart = this.#updateBodyStart(bodyStart, firstCalls.get(this.getCalleeName(decl.id)))
                    }
                }
            }
            if (txts.length > prevMsgsLen || this.patternMatchMods > prevPatternMods || this.hasReturn(bod)) {
                bodyStart = this.#updateBodyStart(bodyStart, bod.start)
            }
        }
        if (bodyStart) {
            this.realBodyStarts.add(bodyStart)
        }
        return txts
    }

    getRealBodyStart(nodes: (Estree.Statement | Estree.ModuleDeclaration)[]): number | undefined {
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

    visitFunctionBody(node: Estree.BlockStatement | Estree.Expression, end?: number): Text[] {
        const prevPatternMods = this.patternMatchMods
        const txts = this.visit(node)
        if (txts.length > 0 || this.patternMatchMods > prevPatternMods) {
            const initRuntime = this.initRuntime()
            if (initRuntime) {
                if (node.type === 'BlockStatement') {
                    this.mstr.prependLeft(this.getRealBodyStart(node.body) ?? node.start, initRuntime)
                } else {
                    // get real start if surrounded by parens
                    let start = node.start - 1
                    for (; start > 0; start--) {
                        const char = this.content[start]!
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
        return txts
    }

    visitFunctionDeclaration(node: Estree.FunctionDeclaration): Text[] {
        return this.inScope({ type: 'function', name: node.id.name }, () => this.visitFunctionBody(node.body))
    }

    visitArrowFunctionExpression(node: Estree.ArrowFunctionExpression | Estree.FunctionExpression): Text[] {
        return this.inScope(
            {
                type: 'funcexpr',
                kind: node.type === 'ArrowFunctionExpression' ? 'arrow' : 'function',
            },
            () => this.visitFunctionBody(node.body, node.end),
        )
    }

    visitFunctionExpression(node: Estree.FunctionExpression): Text[] {
        return this.visitArrowFunctionExpression(node)
    }

    visitBlockStatement(node: Estree.BlockStatement): Text[] {
        return this.visitStatementsNSaveRealBodyStart(node.body)
    }

    visitReturnStatement(node: Estree.ReturnStatement): Text[] {
        return node.argument ? this.visit(node.argument) : []
    }

    visitIfStatement(node: Estree.IfStatement): Text[] {
        const txts = this.visit(node.test)
        txts.push(...this.visit(node.consequent))
        if (node.alternate) {
            txts.push(...this.visit(node.alternate))
        }
        return txts
    }

    visitWhileStatement(node: Estree.WhileStatement): Text[] {
        return [...this.visit(node.test), ...this.visit(node.body)]
    }

    visitDoWhileStatement(node: Estree.DoWhileStatement): Text[] {
        return [...this.visit(node.body), ...this.visit(node.test)]
    }

    visitLabeledStatement(node: Estree.LabeledStatement): Text[] {
        return this.visit(node.body)
    }

    visitParenthesizedExpression(node: Estree.ParenthesizedExpression): Text[] {
        return this.visit(node.expression)
    }

    visitSwitchStatement(node: Estree.SwitchStatement): Text[] {
        return node.cases.flatMap(n => this.visit(n))
    }

    visitSwitchCase(node: Estree.SwitchCase): Text[] {
        const txts = node.consequent.flatMap(n => this.visit(n))
        if (node.test) {
            return [...this.visit(node.test), ...txts]
        }
        return txts
    }

    visitYieldExpression(node: Estree.YieldExpression): Text[] {
        return node.argument ? this.visit(node.argument) : []
    }

    visitClassDeclaration(node: Estree.ClassDeclaration): Text[] {
        const txts: Text[] = []
        this.inScope({ type: 'class', name: node.id.name }, () => {
            for (const body of node.body.body) {
                if (body.type === 'MethodDefinition') {
                    const methodName = this.content.slice(body.key.start, body.key.end)
                    txts.push(...this.visit(body.key))
                    if (body.value.type === 'FunctionExpression') {
                        // and not e.g. TSDeclareMethod
                        txts.push(
                            ...this.inScope({ type: 'method', name: methodName }, () =>
                                this.visitFunctionBody(body.value.body),
                            ),
                        )
                    }
                } else if (body.type === 'StaticBlock') {
                    txts.push(
                        ...this.inScope({ type: 'method', name: '[static]' }, () =>
                            body.body.flatMap(n => this.visit(n)),
                        ),
                    )
                }
            }
        })
        return txts
    }

    visitTemplateLiteralQuasis(node: Estree.TemplateLiteral, forHeuristic = false): [Text, number, Text[]] {
        const txts: Text[] = []
        let body = node.quasis[0]!.value?.cooked ?? ''
        const placeholders: [string, string][] = []
        for (const [i, expr] of node.expressions.entries()) {
            const quasi = node.quasis[i + 1]!
            body += `{${i}}${quasi.value.cooked}`
            placeholders.push([i.toString(), this.content.slice(expr.start, expr.end)])
            if (forHeuristic) {
                // skip modifications and sub visits
                continue
            }
            txts.push(...this.visit(expr))
            const { start, end } = quasi
            this.mstr.remove(start - 1, end)
            if (i + 1 === node.expressions.length) {
                continue
            }
            this.mstr.update(end, end + 2, ', ')
        }
        const msgInfo = newText({
            body: [body],
            path: this.scopePath,
            context: this.commentDirectives.context,
            placeholders,
        })
        txts.push(msgInfo)
        return [msgInfo, forHeuristic ? 0 : this.index.get(getKey(msgInfo.body, msgInfo.context)), txts]
    }

    visitTemplateLiteral(node: Estree.TemplateLiteral, bypassHeuristic = false): Text[] {
        let msgTyp: TextType = 'message'
        let visitRes: [Text, number, Text[]]
        if (bypassHeuristic) {
            visitRes = this.visitTemplateLiteralQuasis(node)
        } else {
            const [msgInfoHeu] = this.visitTemplateLiteralQuasis(node, true)
            const [heuRes] = this.checkHeuristicAllowNew(msgInfoHeu.body[0]!)
            if (!heuRes) {
                return node.expressions.flatMap(n => this.visit(n))
            }
            msgTyp = heuRes
            visitRes = this.visitTemplateLiteralQuasis(node)
        }
        const [msgInfo, index, txts] = visitRes
        msgInfo.type = msgTyp
        const { start: start0, end: end0 } = node.quasis[0]!
        let begin = `${this.vars().rtTrans}(${index}`
        let end = ')'
        if (msgTyp === 'url') {
            begin = `${varNames.urlLocalize}(${begin}`
            end += `, ${this.vars().rtLocale})`
        }
        if (node.expressions.length) {
            begin += ', ['
            end = `]${end}`
            this.mstr.update(start0 - 1, end0 + 2, begin)
            this.mstr.update(node.end - 1, node.end, end)
        } else {
            this.mstr.update(start0 - 1, end0 + 1, begin + end)
        }
        return txts
    }

    visitTaggedTemplateExpression(node: Estree.TaggedTemplateExpression): Text[] {
        return this.inScope({ type: 'call', kind: 'tagged', name: this.getCalleeName(node.tag) }, () => {
            let txts: Text[] = []
            const [msgInfoHeu] = this.visitTemplateLiteralQuasis(node.quasi, true)
            const [heuRes] = this.checkHeuristicAllowNew(msgInfoHeu.body[0]!)
            if (heuRes) {
                const [msgInfo, index, msgsNew] = this.visitTemplateLiteralQuasis(node.quasi)
                msgInfo.type = heuRes
                txts = msgsNew
                this.mstr.appendRight(node.tag.start, `${this.vars().rtTransTag}(`)
                const { start, end, expressions } = node.quasi
                if (expressions.length > 0) {
                    this.mstr.update(start, expressions[0]!.start, `, ${index}, [`)
                    this.mstr.update(end - 1, end, `])`)
                } else {
                    this.mstr.remove(start, start + 1)
                    this.mstr.update(start, end, `, ${index})`)
                }
            }
            return txts
        })
    }

    visitTryStatement(node: Estree.TryStatement): Text[] {
        const txts = this.visit(node.block)
        if (node.handler) {
            txts.push(...this.visit(node.handler.body))
        }
        if (node.finalizer) {
            txts.push(...this.visit(node.finalizer))
        }
        return txts
    }

    visitTSAsExpression(node: Estree.TSAsExpression): Text[] {
        return this.visit(node.expression)
    }

    visitTSTypeAssertion(node: Estree.TSTypeAssertion): Text[] {
        return this.visit(node.expression)
    }

    visitTSSatisfiesExpression(node: Estree.TSSatisfiesExpression): Text[] {
        return this.visit(node.expression)
    }

    visitProgram(node: Estree.Program): Text[] {
        const txts = this.visitStatementsNSaveRealBodyStart(node.body)
        return txts
    }

    visitWithCommentDirectives(node: Estree.AnyNode, func: () => Text[]) {
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
        restoreCommentDirectives(this.commentDirectives, commentDirectives)
        return res
    }

    visit(node: Estree.AnyNode): Text[] {
        return this.visitWithCommentDirectives(node, () => {
            if (this.commentDirectives.forceType === false) {
                return []
            }
            let txts: Text[] = []
            const visitor = this[`visit${node.type}` as `visit${typeof node.type}`]
            if (visitor != null) {
                txts = visitor.bind(this)(node as any)
                // } else {
                //     console.log(node)
            }
            return txts
        })
    }

    finalize(txts: Text[], hmrHeaderIndex: number, additionalHeader = ''): TransformOutput {
        return {
            txts: txts,
            output: header => {
                this.mstr.prependRight(hmrHeaderIndex, `\n${header}\n${additionalHeader}\n`)
                return {
                    code: this.mstr.toString(),
                    map: this.mstr.generateMap(),
                }
            },
        }
    }

    transform(): TransformOutput {
        const [ast, comments] = parseScript(this.content)
        this.comments = comments
        return this.finalize(this.visit(ast), this.getRealBodyStart(ast.body) ?? 0)
    }
}
