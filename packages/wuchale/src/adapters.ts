import type { StorageFactory } from './storage.js'
import { type HeuristicFunc, type Scope, singleTxt, type Text } from './text.js'

export const getKey = (text: string | string[], context?: string) => `${singleTxt(text)}\n${context ?? ''}`.trim()

export class IndexTracker {
    #indices: Map<string, number> = new Map()
    #nextIndex: number = 0
    #bypassHas: boolean

    constructor(bypassHas: boolean) {
        this.#bypassHas = bypassHas
    }

    get = (txt: string) => {
        let index = this.#indices.get(txt)
        if (index != null) {
            return index
        }
        index = this.#nextIndex
        this.#indices.set(txt, index)
        this.#nextIndex++
        return index
    }

    has = (txt: string) => this.#bypassHas || this.#indices.has(txt)

    getAll = () => this.#indices.entries()
}

export type GlobConf =
    | string
    | string[]
    | {
          include: string | string[]
          ignore: string | string[]
      }

export type RuntimeExpr = {
    plain: string
    reactive: string
}

export type UrlMatcher = (url: string) => readonly [number, string[]] | null

export type TransformCtx = {
    content: string
    filename: string
    index: IndexTracker
    expr: RuntimeExpr
    matchUrl: UrlMatcher
}

export type TransformOutputCode = {
    code?: string
    map?: any
}

export type TransformOutputFunc = (header: string) => TransformOutputCode

export type TransformOutput = {
    output: TransformOutputFunc
    txts: Text[]
}

export type TransformFunc = (expr: TransformCtx) => TransformOutput
export type TransformFuncAsync = (expr: TransformCtx) => Promise<TransformOutput>

export type WrapFunc = (expr: string) => string

export type DecideReactiveArgs<RTCtxT = any /* can be changed at the adapter */> = [
    path: Scope[],
    file: string,
    ctx: RTCtxT,
]

type RuntimeConfDetails = {
    wrapInit: WrapFunc
    wrapUse: WrapFunc
}

export type RuntimeConf = {
    /** return null to disable */
    initReactive: (...args: DecideReactiveArgs) => boolean | null
    useReactive: boolean | ((...args: DecideReactiveArgs) => boolean)
    plain: RuntimeConfDetails
    reactive: RuntimeConfDetails
}

export type LoaderPath = {
    client: string
    server: string
}

export type URLConf = {
    patterns?: string[]
    localize?: boolean | string
}

export type LoadGroupPatt = string | string[]

export type AdapterPassThruOpts = {
    sourceLocale?: string
    files: GlobConf
    storage: StorageFactory
    loading: {
        direct: boolean
        granular: boolean
        group: LoadGroupPatt[]
    }
    url?: URLConf
    runtime: RuntimeConf
}

export type Adapter = AdapterPassThruOpts & {
    transform: TransformFunc | TransformFuncAsync
    /** possible filename extensions for loader. E.g. `.js` */
    loaderExts: [string, ...string[]]
    /** default loaders to copy, `null` means custom */
    defaultLoaderPath: LoaderPath | string | null
    /** names to import from loaders, should avoid collision with code variables */
    getRuntimeVars?: Partial<RuntimeExpr>
}

export type CodePattern = {
    name: string
    args: ('message' | 'locale' | 'other')[]
}

export type LoaderChoice<LoadersAvailable> = LoadersAvailable | (string & {}) | 'custom'

export type AdapterArgs<LoadersAvailable> = AdapterPassThruOpts & {
    loader: LoaderChoice<LoadersAvailable>
    heuristic: HeuristicFunc
    patterns: CodePattern[]
}
