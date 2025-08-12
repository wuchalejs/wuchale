import type { ItemType } from "./gemini.js"

type TxtScope = "script" | "markup" | "attribute"

export type HeuristicDetailsBase = {
    scope: TxtScope
    element?: string
    attribute?: string
}

export type ScriptDeclType = "variable" | "function" | "expression"

export type HeuristicDetails = HeuristicDetailsBase & {
    file: string
    /* the type of the top level declaration */
    declaring?: ScriptDeclType
    /* the name of the function being defined, '' for arrow or null for global */
    funcName?: string | null
    /* the name of the call at the top level */
    topLevelCall?: string
    /* the name of the nearest call (for arguments) */
    call?: string
}

export type HeuristicFunc = (text: string, details: HeuristicDetails) => boolean | null | undefined

export function defaultHeuristic(text: string, details: HeuristicDetails) {
    if (text.search(/\p{L}/u) === -1) {
        return false
    }
    if (details.scope === 'markup') {
        return true
    }
    // script and attribute
    // only allow non lower-case English letter beginnings
    if (!/\p{L}/u.test(text[0]) || /[a-z]/.test(text[0])) {
        return false
    }
    if (details.scope !== 'script') {
        return true
    }
    if (details.declaring === 'expression' && !details.funcName) {
        return false
    }
    return !details.call?.startsWith('console.')
}

// only allow inside function definitions for script scope
export const defaultHeuristicFuncOnly: HeuristicFunc = (text, details) => {
    return defaultHeuristic(text, details) && (details.scope !== 'script' || details.funcName != null)
}

export const defaultGenerateLoadID = (filename: string) => filename.replace(/[^a-zA-Z0-9_]+/g, '_')

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

export interface Catalog {
    [key: string]: ItemType
}

export type CommentDirectives = {
    forceInclude?: boolean
    context?: string
}

export class IndexTracker {

    indices: Record<string, number> = {}
    nextIndex: number = 0

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

export type GlobConf = string | string[] | {
    include: string | string[],
    ignore: string | string[],
}

export type TransformHeader = {
    head: string,
    expr: string,
}

type TransformCtx = {
    content: string
    filename: string
    index: IndexTracker
    header: TransformHeader
}

export type TransformOutput = {
    code?: string
    map?: any
    txts: NestText[]
}

export type TransformFunc = (ctx: TransformCtx) => TransformOutput

export type AdapterPassThruOpts = {
    files: GlobConf
    catalog: string
    granularLoad: boolean
    bundleLoad: boolean,
    generateLoadID: (filename: string) => string
    writeFiles: {
        compiled?: boolean
        proxy?: boolean
        transformed?: boolean
        outDir?: string
    }
    /* the name of the function to import from the loader */
    importName: string
}

export type Adapter = AdapterPassThruOpts & {
    transform: TransformFunc
    /** possible filename extensions for loader. E.g. `.js` */
    loaderExts: string[]
    /** available loader names, can do auto detection logic to sort, dependencies given */
    defaultLoaders: (dependencies: Set<string>) => string[] | Promise<string[]>
    /* Can return different file paths based on conditions */
    defaultLoaderPath: (loaderName: string) => string
}

export type RuntimeOptions = {
    /* whether to initialize in funcName scope ('' for arrow, null for global) */
    initInScope: (details: { funcName?: string, parentFunc?: string, file: string }) => boolean
    /* wrap initialize expression, e.g. in $derived() for svelte */
    wrapInit: (expr: string) => string
    /* wrap use function, e.g. to change _w_runtime_ to _w_runtime_() for solid */
    wrapExpr: (expr: string) => string
}

export type AdapterArgs = Partial<AdapterPassThruOpts> & {
    heuristic?: HeuristicFunc
    pluralsFunc?: string
    /* runtime instance options */
    runtime?: Partial<RuntimeOptions>
}
