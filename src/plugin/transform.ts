// $$ cd .. && npm run test

import MagicString from "magic-string"
import type { ItemType } from "./gemini.js"
import type Estree from 'estree'
import type { Options as ParserOptions } from "acorn"
import { Parser } from 'acorn'
import { tsPlugin } from '@sveltejs/acorn-typescript'

type TxtScope = "script" | "markup" | "attribute"

type HeuristicDetailsBase = {
    scope: TxtScope,
    element?: string,
    attribute?: string,
}

type HeuristicDetails = HeuristicDetailsBase & {
    file: string,
    topLevelDef?: "variable" | "function",
    topLevelCall?: string,
    call?: string,
}

export type TransformOutput = {
    code?: string,
    map?: any,
    txts: NestText[],
}

export type HeuristicFunc = (text: string, details: HeuristicDetails) => boolean | null

export function defaultHeuristic(text: string, details: HeuristicDetails) {
    if (text.search(/\p{L}/u) === -1) {
        return false
    }
    if (details.scope === 'markup') {
        return true
    }
    // script and attribute
    if (details.scope === 'script' && details.call?.startsWith('console.')) {
        return false
    }
    // only allow non lower-case English letter beginnings
    return (/\p{L}/u).test(text[0]) && !/[a-z]/.test(text[0])
}

export const rtFunc = 'wuchaleTrans'
export const rtFuncPlural = 'wuchaleTransPlural'
export const rtPluralsRule = 'wuchalePluralsRule'
export const rtFuncCtx = 'wuchaleTransCtx'
export const importModule = `import {${rtFunc}, ${rtFuncCtx}, ${rtFuncPlural}, ${rtPluralsRule}} from "wuchale/runtime.svelte.js"`

export class NestText {

    text: string[] // array for plurals
    plural: boolean = false
    scope: TxtScope
    context: string

    constructor(txt: string | string[], scope: TxtScope, context: string | null) {
        if (typeof txt === 'string') {
            this.text = [txt]
        } else {
            this.text = txt
        }
        this.scope = scope
        this.context = context ?? null
    }

    toKey = () => `${this.text.slice(0, 2).join('\n')}\n${this.context ?? ''}`.trim()

}

export interface Translations {
    [key: string]: ItemType
}

export type CommentDirectives = {
    forceInclude?: boolean
    context?: string
}

export class IndexTracker {

    indices: { [key: string]: number } = {}
    nextIndex: number = 0

    reload(sourceTranslations: Translations) {
        this.nextIndex = 0
        this.indices = {}
        for (const txt of Object.keys(sourceTranslations)) {
            // guaranteed order for strings since ES2015
            this.indices[txt] = this.nextIndex
            this.nextIndex++
        }
    }

    get = (txt: string) => {
        if (txt in this.indices) {
            return this.indices[txt]
        }
        const index = this.nextIndex
        this.indices[txt] = index
        this.nextIndex++
        return index
    }
}

const scriptParseOptions: ParserOptions = {
    sourceType: 'module',
    ecmaVersion: 'latest',
    locations: true
}

const ScriptParser = Parser.extend(tsPlugin())

export function parseScript(content: string) {
    return ScriptParser.parse(content, scriptParseOptions)
}

export class Transformer {

    index: IndexTracker
    heuristic: HeuristicFunc
    content: string
    filename: string
    mstr: MagicString
    pluralFunc: string

    // state
    commentDirectives: CommentDirectives = {}
    insideScript: boolean = false
    topLevelDef: "variable" | "function" = null
    currentCall: string
    currentTopLevelCall: string

    constructor(content: string, filename: string, index: IndexTracker, heuristic: HeuristicFunc, pluralsFunc: string) {
        this.index = index
        this.heuristic = heuristic
        this.pluralFunc = pluralsFunc
        this.content = content
        this.filename = filename
    }

    checkHeuristic = (text: string, detailsBase: HeuristicDetailsBase): [boolean, NestText] => {
        if (!text) {
            // nothing to ask
            return [false, null]
        }
        let extract = this.commentDirectives.forceInclude
        if (extract == null) {
            const details = {
                file: this.filename,
                call: this.currentCall,
                topLevelDef: this.topLevelDef,
                topLevelCall: this.currentTopLevelCall,
                ...detailsBase,
            }
            extract = this.heuristic(text, details)
                ?? defaultHeuristic(text, details)
                ?? true
        }
        return [extract, new NestText(text, detailsBase.scope, this.commentDirectives.context)]
    }

    visitLiteral = (node: Estree.Literal & { start: number; end: number }): NestText[] => {
        if (typeof node.value !== 'string') {
            return []
        }
        const { start, end } = node
        const [pass, txt] = this.checkHeuristic(node.value, {scope: 'script'})
        if (!pass) {
            return []
        }
        this.mstr.update(start, end, `${rtFunc}(${this.index.get(txt.toKey())})`)
        return [txt]
    }

    visitArrayExpression = (node: Estree.ArrayExpression): NestText[] => {
        const txts = []
        for (const elm of node.elements) {
            txts.push(...this.visit(elm))
        }
        return txts
    }

    visitObjectExpression = (node: Estree.ObjectExpression): NestText[] => {
        const txts = []
        for (const prop of node.properties) {
            txts.push(...this.visit(prop))
        }
        return txts
    }

    visitProperty = (node: Estree.Property): NestText[] => [
        ...this.visit(node.key),
        ...this.visit(node.value),
    ]

    visitSpreadElement = (node: Estree.SpreadElement): NestText[] => this.visit(node.argument)

    visitMemberExpression = (node: Estree.MemberExpression): NestText[] => [
        ...this.visit(node.object),
        ...this.visit(node.property),
    ]

    visitNewExpression = (node: Estree.NewExpression): NestText[] => node.arguments.map(this.visit).flat()

    defaultVisitCallExpression = (node: Estree.CallExpression): NestText[] => {
        const txts = [...this.visit(node.callee)]
        const currentCall = this.currentCall
        this.currentCall = this.getCalleeName(node.callee)
        for (const arg of node.arguments) {
            txts.push(...this.visit(arg))
        }
        this.currentCall = currentCall // restore
        return txts
    }

    visitCallExpression = (node: Estree.CallExpression): NestText[] => {
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
        const nTxt = new NestText(candidates, 'script', this.commentDirectives.context)
        nTxt.plural = true
        const index = this.index.get(nTxt.toKey())
        // @ts-ignore
        this.mstr.update(secondArg.start, node.end - 1, `${rtFuncPlural}(${index}), ${rtPluralsRule}()`)
        return [nTxt]
    }

    visitBinaryExpression = (node: Estree.BinaryExpression): NestText[] => [
        ...this.visit(node.left),
        ...this.visit(node.right),
    ]

    visitUnaryExpression = (node: Estree.UnaryExpression): NestText[] => this.visit(node.argument)

    visitLogicalExpression = (node: Estree.LogicalExpression): NestText[] => [
        ...this.visit(node.left),
        ...this.visit(node.right),
    ]

    visitAwaitExpression = (node: Estree.AwaitExpression): NestText[] => this.visit(node.argument)

    visitAssignmentExpression = this.visitBinaryExpression

    visitExpressionStatement = (node: Estree.ExpressionStatement): NestText[] => this.visit(node.expression)

    visitForOfStatement = (node: Estree.ForOfStatement): NestText[] => [
        ...this.visit(node.left),
        ...this.visit(node.right),
        ...this.visit(node.body),
    ]

    visitForInStatement = (node: Estree.ForInStatement): NestText[] => [
        ...this.visit(node.left),
        ...this.visit(node.right),
        ...this.visit(node.body),
    ]

    visitForStatement = (node: Estree.ForStatement): NestText[] => [
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

    visitVariableDeclaration = (node: Estree.VariableDeclaration): NestText[] => {
        const txts = []
        let atTopLevelDefn = this.insideScript && !this.topLevelDef
        for (const dec of node.declarations) {
            if (!dec.init) {
                continue
            }
            // store the name of the function after =
            if (atTopLevelDefn) {
                if (dec.init.type === 'ArrowFunctionExpression') {
                    this.topLevelDef = 'function'
                } else {
                    this.topLevelDef = 'variable'
                    if (dec.init.type === 'CallExpression') {
                        this.currentTopLevelCall = this.getCalleeName(dec.init.callee)
                    }
                }
            }
            const decVisit = this.visit(dec.init)
            if (!decVisit.length) {
                continue
            }
            txts.push(...decVisit)
        }
        if (atTopLevelDefn) {
            this.currentTopLevelCall = null // reset
            this.topLevelDef = null
        }
        return txts
    }

    visitExportNamedDeclaration = (node: Estree.ExportNamedDeclaration): NestText[] => node.declaration ? this.visit(node.declaration) : []

    visitFunctionDeclaration = (node: Estree.FunctionDeclaration): NestText[] => {
        const topLevelDef = this.topLevelDef
        this.topLevelDef = 'function'
        const txts = this.visit(node.body)
        if (!topLevelDef) {
            this.topLevelDef = null
        }
        return txts
    }

    visitArrowFunctionExpression = (node: Estree.ArrowFunctionExpression): NestText[] => this.visit(node.body)

    visitBlockStatement = (node: Estree.BlockStatement): NestText[] => {
        const txts = []
        for (const statement of node.body) {
            txts.push(...this.visit(statement))
        }
        return txts
    }

    visitReturnStatement = (node: Estree.ReturnStatement): NestText[] => {
        if (node.argument) {
            return this.visit(node.argument)
        }
        return []
    }

    visitIfStatement = (node: Estree.IfStatement): NestText[] => {
        const txts = this.visit(node.test)
        txts.push(...this.visit(node.consequent))
        if (node.alternate) {
            txts.push(...this.visit(node.alternate))
        }
        return txts
    }

    visitTemplateLiteral = (node: Estree.TemplateLiteral): NestText[] => {
        const txts = []
        let heurTxt = ''
        for (const quasi of node.quasis) {
            heurTxt += quasi.value.cooked ?? ''
            if (!quasi.tail) {
                heurTxt += '#'
            }
        }
        heurTxt = heurTxt.trim()
        const [pass] = this.checkHeuristic(heurTxt, {scope: 'script'})
        if (!pass) {
            return txts
        }
        const quasi0 = node.quasis[0]
        // @ts-ignore
        const { start: start0, end: end0 } = quasi0
        let txt = quasi0.value?.cooked ?? ''
        for (const [i, expr] of node.expressions.entries()) {
            txts.push(...this.visit(expr))
            const quasi = node.quasis[i + 1]
            txt += `{${i}}${quasi.value.cooked}`
            // @ts-ignore
            const { start, end } = quasi
            this.mstr.remove(start - 1, end)
            if (i + 1 === node.expressions.length) {
                continue
            }
            this.mstr.update(end, end + 2, ', ')
        }
        const nTxt = new NestText(txt, 'script', this.commentDirectives.context)
        let begin = `${rtFunc}(${this.index.get(nTxt.toKey())}`
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
        txts.push(nTxt)
        return txts
    }

    visitProgram = (node: Estree.Program, needImport = true): NestText[] => {
        const txts = []
        this.insideScript = true
        for (const child of node.body) {
            txts.push(...this.visit(child))
        }
        this.insideScript = false
        if (needImport) {
            // @ts-ignore
            this.mstr.appendRight(node.start, importModule + '\n')
        }
        return txts
    }

    processCommentDirectives = (data: string): CommentDirectives => {
        const directives: CommentDirectives = this.commentDirectives
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

    visit = (node: Estree.BaseNode): NestText[] => {
        // for estree
        const commentDirectives = this.commentDirectives
        for (const comment of node.leadingComments ?? []) {
            this.commentDirectives = this.processCommentDirectives(comment.value.trim())
        }
        let txts = []
        if (this.commentDirectives.forceInclude !== false) {
            const methodName = `visit${node.type}`
            if (methodName in this) {
                txts = this[methodName](node)
                // } else {
                //     console.log(node)
            }
        }
        this.commentDirectives = commentDirectives // restore
        return txts
    }

    finalize = (txts: NestText[]): TransformOutput => {
        const output = {txts}
        if (txts.length === 0) {
            return output
        }
        return {
            txts,
            code: this.mstr.toString(),
            map: this.mstr.generateMap(),
        }
    }

    transform = (): TransformOutput => {
        const ast = parseScript(this.content)
        this.mstr = new MagicString(this.content)
        return this.finalize(this.visit(ast))
    }
}

export type GlobConf = string | {
    pattern: string[],
    ignore: string[],
}

export type TransformFunc = (content: string, filename: string, index: IndexTracker) => TransformOutput

export interface TransformerType {
    name: string
    transform: TransformFunc
    files: GlobConf[]
    catalog: string
}

export interface AdapterArgs {
    files: string[]
    catalog: string
    heuristic?: HeuristicFunc
    pluralsFunc?: string
}

export type AdapterFunc = (args: AdapterArgs) => TransformerType

const esAdapter: AdapterFunc = (args: AdapterArgs) => {
    const { heuristic = defaultHeuristic, pluralsFunc = 'plural', ...rest } = args
    return {
        name: 'es',
        transform: (content, filename, index) => {
            return new Transformer(content, filename, index, heuristic, pluralsFunc).transform()
        },
        ...rest,
    }
}

export default esAdapter
