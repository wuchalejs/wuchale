import type { ItemType } from "./gemini.js"

type TxtScope = "script" | "markup" | "attribute"

export type HeuristicDetailsBase = {
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

export type GlobConf = string | {
    pattern: string[],
    ignore: string[],
}

export type TransformFunc = (content: string, filename: string, index: IndexTracker) => TransformOutput

export type ProxyModuleFunc = (virtModName: string, locale: string, pluginName: string) => string

export interface Adapter {
    name: string
    key: string
    transform: TransformFunc
    files: GlobConf[]
    catalog: string
    proxyModule: {
        dev: ProxyModuleFunc
        other: ProxyModuleFunc
    }
}

export interface AdapterArgs {
    files: string[]
    catalog: string
    heuristic?: HeuristicFunc
    pluralsFunc?: string
    key?: string
}

export type AdapterFunc = (args: AdapterArgs) => Adapter
