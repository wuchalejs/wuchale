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

export type HeuristicFunc = (msgStr: string, details: HeuristicDetails) => boolean | null | undefined

export function defaultHeuristic(msgStr: string, details: HeuristicDetails) {
    if (msgStr.search(/\p{L}/u) === -1) {
        return false
    }
    if (details.scope === 'markup') {
        return true
    }
    // script and attribute
    // only allow non lower-case English letter beginnings
    if (!/\p{L}/u.test(msgStr[0]) || /[a-z]/.test(msgStr[0])) {
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
export const defaultHeuristicFuncOnly: HeuristicFunc = (msgStr, details) => {
    return defaultHeuristic(msgStr, details) && (details.scope !== 'script' || details.funcName != null)
}

export const defaultGenerateLoadID = (filename: string) => filename.replace(/[^a-zA-Z0-9_]+/g, '_')

export class Message {

    msgStr: string[] // array for plurals
    plural: boolean = false
    scope: TxtScope
    context: string

    constructor(msgStr: string | string[], scope: TxtScope, context: string | null) {
        if (typeof msgStr === 'string') {
            this.msgStr = [msgStr]
        } else {
            this.msgStr = msgStr
        }
        this.scope = scope
        this.context = context ?? null
    }

    toKey = () => `${this.msgStr.slice(0, 2).join('\n')}\n${this.context ?? ''}`.trim()

}

export type CommentDirectives = {
    forceInclude?: boolean
    context?: string
}

export class IndexTracker {

    indices: Record<string, number> = {}
    nextIndex: number = 0

    get = (msgStr: string) => {
        if (msgStr in this.indices) {
            return this.indices[msgStr]
        }
        const index = this.nextIndex
        this.indices[msgStr] = index
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
    msgs: Message[]
}

export type TransformFunc = (ctx: TransformCtx) => TransformOutput

export type AdapterPassThruOpts = {
    files: GlobConf
    catalog: string
    granularLoad: boolean
    bundleLoad: boolean,
    generateLoadID: (filename: string) => string
    loaderPath?: string
    writeFiles: {
        compiled?: boolean
        proxy?: boolean
        transformed?: boolean
        outDir?: string
    }
}

export type Adapter = AdapterPassThruOpts & {
    transform: TransformFunc
    /** possible filename extensions for loader. E.g. `.js` */
    loaderExts: string[]
    /** available loader names, can do auto detection logic to sort, dependencies given */
    defaultLoaders: () => string[] | Promise<string[]>
    /* Can return different file paths based on conditions */
    defaultLoaderPath: (loaderName: string) => string
    /* docs specific to the adapter */
    docsUrl: string
}

export type AdapterArgs = Partial<AdapterPassThruOpts> & {
    heuristic?: HeuristicFunc
    pluralsFunc?: string
}
