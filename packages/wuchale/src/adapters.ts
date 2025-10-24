import type { CompiledElement } from "./compile.js"

type TxtScope = "script" | "markup" | "attribute"

export type HeuristicDetailsBase = {
    scope: TxtScope
    element?: string
    attribute?: string
}

export type ScriptDeclType = "variable" | "function" | "class" | "expression"

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

export class Message {

    msgStr: string[] // array for plurals
    plural: boolean = false
    context: string
    comments: string[] = []
    details: HeuristicDetails

    constructor(msgStr: string | string[], heuristicDetails: HeuristicDetails, context: string | null) {
        if (typeof msgStr === 'string') {
            this.msgStr = [msgStr]
        } else {
            this.msgStr = msgStr.filter(str => str != null)
        }
        this.msgStr = this.msgStr.map(
            msg => msg.split('\n').map(line => line.trim()).join('\n')
        )
        this.details = heuristicDetails
        this.context = context ?? null
    }

    toKey = () => `${this.msgStr.slice(0, 2).join('\n')}\n${this.context ?? ''}`.trim()

}

export type HeuristicFunc = (msg: Message) => boolean | null | undefined

const ignoreElements = ['style', 'path', 'code', 'pre']
const ignoreAttribs = [['form', 'method']]

/** Default heuristic */
export function defaultHeuristic(msg: Message) {
    const msgStr = msg.msgStr.join('\n')
    if (msgStr.search(/\p{L}/u) === -1) {
        return false
    }
    if (msg.details.element && ignoreElements.includes(msg.details.element)) {
        return false
    }
    if (msg.details.scope === 'attribute') {
        for (const [element, attrib] of ignoreAttribs) {
            if (msg.details.element === element && msg.details.attribute === attrib) {
                return false
            }
        }
    }
    if (msg.details.scope === 'markup') {
        return true
    }
    // script and attribute
    // only allow non lower-case English letter beginnings
    if (!/\p{L}/u.test(msgStr[0]) || /[a-z]/.test(msgStr[0])) {
        return false
    }
    if (msg.details.scope !== 'script') {
        return true
    }
    if (msg.details.declaring === 'expression' && !msg.details.funcName) {
        return false
    }
    return !msg.details.call?.startsWith('console.') && msg.details.call !== 'fetch'
}

/** Default heuristic which ignores messages outside functions in the `script` scope */
export const defaultHeuristicFuncOnly: HeuristicFunc = msg => {
    return defaultHeuristic(msg) && (msg.details.scope !== 'script' || msg.details.funcName != null)
}

export const defaultGenerateLoadID = (filename: string) => filename.replace(/[^a-zA-Z0-9_]+/g, '_')

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

export type CatalogExpr = {
    plain: string
    reactive: string
}

export type TransformHeader = {
    head: string
}

type TransformCtx = {
    content: string
    filename: string
    index: IndexTracker
    expr: CatalogExpr
}

export type HMRData = {
    version: number
    data: Record<string, [number, CompiledElement][]>
}

export type TransformOutputFunc = (header: string) => {
    code?: string
    map?: any
}

export type TransformOutput = {
    output: TransformOutputFunc
    msgs: Message[]
}

export type TransformFunc = (expr: TransformCtx) => TransformOutput

export type WrapFunc = (expr: string) => string

export type UseReactiveFunc = (details: {funcName?: string, nested: boolean, file: string, additional: object}) => {
    /** null to disable initializing */
    init: boolean | null
    use: boolean
}

type RuntimeConfDetails = {
    wrapInit: WrapFunc
    wrapUse: WrapFunc
}

export type RuntimeConf = {
    useReactive: UseReactiveFunc
    plain: RuntimeConfDetails
    reactive: RuntimeConfDetails
}

export type LoaderPath = {
    client: string
    server: string
}

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
    runtime: Partial<RuntimeConf>
}

export type Adapter = AdapterPassThruOpts & {
    transform: TransformFunc
    /** possible filename extensions for loader. E.g. `.js` */
    loaderExts: string[]
    /** default loaders to copy, `null` means custom */
    defaultLoaderPath: LoaderPath | string | null
    /** docs specific to the adapter */
    docsUrl: string
}

export type CodePattern = {
    name: string
    args: ('message' | 'pluralFunc' | 'locale' | 'other')[]
}

export type LoaderChoice<LoadersAvailable> = LoadersAvailable | string & {} | 'custom'

export type AdapterArgs<LoadersAvailable> = Partial<AdapterPassThruOpts> & {
    loader: LoaderChoice<LoadersAvailable>
    heuristic?: HeuristicFunc
    patterns?: CodePattern[]
}
