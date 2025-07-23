import type { ItemType } from "./gemini.js"

type TxtScope = "script" | "markup" | "attribute"

export type HeuristicDetailsBase = {
    scope: TxtScope,
    element?: string,
    attribute?: string,
}

export type ScriptTopLevel = "variable" | "function" | "expression"

type HeuristicDetails = HeuristicDetailsBase & {
    file: string,
    topLevel?: ScriptTopLevel,
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
    // only allow non lower-case English letter beginnings
    if (!/\p{L}/u.test(text[0]) || /[a-z]/.test(text[0])) {
        return false
    }
    if (details.scope !== 'script') {
        return true
    }
    return !details.call?.startsWith('console.')
}

// only allow inside function definitions
export const defaultHeuristicFuncOnly: HeuristicFunc = (text, details) => {
    return defaultHeuristic(text, details) && details.topLevel === 'function'
}

export const defaultGenerateID = (filename: string) => {
    return filename.replace('..', '__').replace(/[^a-zA-Z0-9-_]+/g, '_')
}

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

    indices: { [key: string]: number } = {}
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

type TransformCtx = {
    content: string
    filename: string
    index: IndexTracker
    loaderPath: string
    fileID: string
    key: string
    locales: string[]
}

export type TransformFunc = (ctx: TransformCtx) => TransformOutput

type ProxyModuleCtx = {
    fileID: string | null
    eventSend: string
    eventReceive: string
    compiled: string
    plural: string
}

export type ProxyModuleFunc = (ctx: ProxyModuleCtx) => string

type AdapterPassThruOpts = {
    files: GlobConf
    catalog: string
    perFile: boolean
    generateID: (filename: string) => string
}

export type Adapter = AdapterPassThruOpts & {
    transform: TransformFunc
    /** filename extension for loader. E.g. `.js` */
    loaderExt: string
    proxyModuleDev: ProxyModuleFunc
    loaderTemplateFile: string
}

export type AdapterArgs = Partial<AdapterPassThruOpts> & {
    heuristic?: HeuristicFunc
    pluralsFunc?: string
}
