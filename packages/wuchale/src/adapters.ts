import type { CompiledElement } from "./compile.js"
import type { URLLocalizer } from "./url.js"

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

export type MessageType = 'message' | 'url'

const someHeuDet: HeuristicDetails = {file: '', scope: 'markup'}

export class Message {

    msgStr: string[] // array for plurals
    plural: boolean = false
    context?: string
    comments: string[] = []
    details: HeuristicDetails
    type: MessageType = 'message'

    constructor(msgStr: string | (string | null | undefined)[], heuristicDetails: HeuristicDetails = someHeuDet, context?: string) {
        if (typeof msgStr === 'string') {
            this.msgStr = [msgStr]
        } else {
            this.msgStr = msgStr.filter(str => str != null)
        }
        this.msgStr = this.msgStr.map(
            msg => msg.split('\n').map(line => line.trim()).join('\n')
        )
        this.details = heuristicDetails
        this.context = context
    }

    toKey = () => `${this.msgStr.slice(0, 2).join('\n')}\n${this.context ?? ''}`.trim()

}

export type HeuristicResultChecked = MessageType | false // after checking all heuristic functions
export type HeuristicResult = HeuristicResultChecked | null | undefined

export type HeuristicFunc = (msg: Message) => HeuristicResult

export const defaultHeuristicOpts = {
    ignoreElements: ['script', 'style', 'path', 'code', 'pre'],
    ignoreAttribs: [['form', 'method']],
    ignoreCalls: ['fetch'],
    urlAttribs: [['a', 'href']],
    urlCalls: [] as string[],
}

export type CreateHeuristicOpts = typeof defaultHeuristicOpts

export function createHeuristic(opts: CreateHeuristicOpts): HeuristicFunc {
    return msg => {
        if (msg.details.element && opts.ignoreElements.includes(msg.details.element)) {
            return false
        }
        if (msg.details.scope === 'attribute') {
            for (const [element, attrib] of opts.ignoreAttribs) {
                if (msg.details.element === element && msg.details.attribute === attrib) {
                    return false
                }
            }
        }
        const msgStr = msg.msgStr.join('\n')
        const looksLikeUrlPath = msgStr.startsWith('/') && !msgStr.includes(' ')
        if (looksLikeUrlPath && (msg.details.scope === 'script' || msg.details.scope === 'attribute')) {
            if (msg.details.call) {
                for (const call of opts.urlCalls) {
                    if (msg.details.call === call) {
                        return 'url'
                    }
                }
            }
            if (msg.details.attribute) {
                for (const [element, attrib] of opts.urlAttribs) {
                    if (msg.details.element === element && msg.details.attribute === attrib) {
                        return 'url'
                    }
                }
            }
        }
        if (!/\p{L}/u.test(msgStr)) {
            return false
        }
        if (msg.details.scope === 'markup') {
            return 'message'
        }
        // script and attribute
        // ignore:
        //  non-letter beginnings
        //  lower-case English letter beginnings
        //  containing only upper-case English and non-letters
        if (!/\p{L}/u.test(msgStr[0]) || /[a-z]/.test(msgStr[0]) || /^([A-Z]|\P{L})+$/u.test(msgStr)) {
            return false
        }
        if (msg.details.scope === 'attribute') {
            return 'message'
        }
        if (msg.details.declaring === 'expression' && !msg.details.funcName) {
            return false
        }
        if (!msg.details.call || !msg.details.call.startsWith('console.') && !opts.ignoreCalls.includes(msg.details.call)) {
            return 'message'
        }
        return false
    }
}

/** Default heuristic */
export const defaultHeuristic = createHeuristic(defaultHeuristicOpts)

/** Default heuristic which ignores messages outside functions in the `script` scope */
export const defaultHeuristicFuncOnly: HeuristicFunc = msg => {
    if (defaultHeuristic(msg) && (msg.details.scope !== 'script' || msg.details.funcName != null)) {
        return 'message'
    }
    return false
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

export type UrlMatcher = (url: string) => string | null | undefined

type TransformCtx = {
    content: string
    filename: string
    index: IndexTracker
    expr: CatalogExpr
    matchUrl: UrlMatcher
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
export type TransformFuncAsync = (expr: TransformCtx) => Promise<TransformOutput>

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
    localesDir: string
    /** if writing transformed code to a directory is desired, specify this */
    outDir?: string
    granularLoad: boolean
    bundleLoad: boolean
    url?: {
        patterns?: string[]
        localize?: boolean | URLLocalizer
    }
    generateLoadID: (filename: string) => string
    runtime: Partial<RuntimeConf>
}

export type Adapter = AdapterPassThruOpts & {
    transform: TransformFunc | TransformFuncAsync
    /** possible filename extensions for loader. E.g. `.js` */
    loaderExts: string[]
    /** default loaders to copy, `null` means custom */
    defaultLoaderPath: LoaderPath | string | null
    /** names to import from loaders, should avoid collision with code variables */
    getRuntimeVars?: Partial<CatalogExpr>
}

export type CodePattern = {
    name: string
    args: ('message' | 'pluralFunc' | 'locale' | 'other')[]
}

export type LoaderChoice<LoadersAvailable> = LoadersAvailable | string & {} | 'custom'

export type AdapterArgs<LoadersAvailable> = AdapterPassThruOpts & {
    loader: LoaderChoice<LoadersAvailable>
    heuristic: HeuristicFunc
    patterns: CodePattern[]
}
