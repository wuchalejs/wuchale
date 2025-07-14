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

    reload(sourceCatalog: Catalog) {
        this.nextIndex = 0
        this.indices = {}
        for (const txt of Object.keys(sourceCatalog)) {
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

export type GlobConf = string | {
    pattern: string[],
    ignore: string[],
}

export type TransformFunc = (content: string, filename: string, index: IndexTracker, key: string) => TransformOutput

export type ProxyModuleFunc = (virtModName: string) => string

export interface Adapter {
    transform: TransformFunc
    files: GlobConf[]
    catalog: string
    /** filename extension for compiled. E.g. `.js` */
    compiledExt: string
    proxyModule: {
        dev: ProxyModuleFunc
        other: ProxyModuleFunc
    }
}

export interface AdapterArgs {
    files?: string[]
    catalog?: string
    heuristic?: HeuristicFunc
    pluralsFunc?: string
}

export type AdapterFunc = (args?: AdapterArgs) => Adapter
