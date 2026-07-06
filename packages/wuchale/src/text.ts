type ElementScope = {
    type: 'element'
    name: string
}

type AttributeScope = {
    type: 'attribute'
    name: string
}

type ExprScope = {
    // as in {interpolations} in markup, or expression statement like 'use strict'
    type: 'expression'
}

type ExportScope = {
    type: 'export'
}

type FuncScope = {
    type: 'function'
    name: string
}

type ArrowScope = {
    type: 'funcexpr'
    kind: 'arrow' | 'function'
}

type AssignScope = {
    type: 'assignment'
} & (
    | {
          left: false
          targets: string[]
      }
    | { left: true }
)

type ClassScope = {
    type: 'class'
    name: string
}

type MethodScope = {
    type: 'method'
    name: string
}

type CallScope = {
    type: 'call'
    kind: 'new' | 'tagged' | 'function'
    name: string
}

type PropertyScope = {
    type: 'property'
    name: string
}

export type Scope =
    | ElementScope
    | AttributeScope
    | ExprScope
    | ExportScope
    | FuncScope
    | ArrowScope
    | AssignScope
    | ClassScope
    | MethodScope
    | CallScope
    | PropertyScope

export type TextType = 'message' | 'url'

export type Text = {
    type: TextType
    body: string[] // array for plurals
    context?: string | undefined
    placeholders: [string, string][]
    path: Scope[]
}

export type HeuristicResultChecked = TextType | false // after checking all heuristic functions
export type HeuristicResult = HeuristicResultChecked | null | undefined

export type HeuristicFunc = (txt: Text, file: string) => HeuristicResult

export const defaultHeuristicOpts = {
    ignoreElements: ['script', 'style', 'path', 'code', 'pre'],
    ignoreAttribs: [['form', 'method']],
    ignoreCalls: ['fetch'],
    urlAttribs: [['a', 'href']],
    urlCalls: [] as string[],
    urlProps: ['href', 'link', 'url'],
}

export type CreateHeuristicOpts = typeof defaultHeuristicOpts

const updatableScopes = new Set<Scope['type']>(['element', 'attribute', 'function', 'funcexpr', 'method'])

export function* ascendPath(path: Scope[]) {
    for (let i = path.length - 1; i >= 0; i--) {
        yield path[i]!
    }
}

export function createHeuristic(opts: CreateHeuristicOpts): HeuristicFunc {
    return txt => {
        let attribute = ''
        let nearestElement = null
        let updateable = false
        for (const s of ascendPath(txt.path)) {
            updateable ||= updatableScopes.has(s.type)
            if (s.type === 'call' && (s.name.startsWith('console.') || opts.ignoreCalls.includes(s.name))) {
                return false
            }
            if (s.type === 'attribute') {
                attribute = s.name
                continue
            }
            if (s.type === 'element') {
                if (
                    opts.ignoreElements.includes(s.name) ||
                    opts.ignoreAttribs.some(([elm, att]) => s.name === elm && attribute === att)
                ) {
                    return false
                }
                nearestElement ||= s.name
            }
        }
        let body = txt.body.join('\n')
        const lastScope = txt.path.at(-1)!
        if (lastScope.type === 'element') {
            // only check the top level for letters
            body = body.replaceAll(/<\d+\/>/g, '#').replaceAll(/<\d+>.+<\/\d+>/g, '#')
        }
        const looksLikeUrlPath = body.startsWith('/') && !body.includes(' ')
        if (looksLikeUrlPath && lastScope.type !== 'element') {
            if (lastScope.type === 'call') {
                for (const call of opts.urlCalls) {
                    if (lastScope.name === call) {
                        return 'url'
                    }
                }
            }
            if (lastScope.type === 'property') {
                for (const prop of opts.urlProps) {
                    if (lastScope.name === prop) {
                        return 'url'
                    }
                }
            }
            if (lastScope.type === 'attribute') {
                for (const [tag, attrib] of opts.urlAttribs) {
                    if (nearestElement === tag && lastScope.name === attrib) {
                        return 'url'
                    }
                }
            }
        }
        if (!/\p{L}/u.test(body)) {
            return false
        }
        if (lastScope.type === 'element') {
            return 'message'
        }
        // script and attribute
        if (/^([A-Z]|\P{L})+$/u.test(body)) {
            // only upper-case English and non-letters
            return false
        }
        if (/^\{\d+\}/.test(body)) {
            // template literals that begin with a placeholder expression
            if (!/\s\p{L}/u.test(body)) {
                // should contain spaces and letters
                return false
            }
        } else if (/[a-z]|\P{L}/u.test(body[0]!)) {
            // ignore non-letter and lower-case English beginnings
            return false
        }
        if (lastScope.type === 'attribute') {
            return 'message'
        }
        if (txt.path[0]?.type === 'expression' && !updateable) {
            // bare expr statement outside markup
            return false
        }
        return 'message'
    }
}

/** Default heuristic */
export const defaultHeuristic = createHeuristic(defaultHeuristicOpts)

/** Default heuristic which ignores texts outside functions in the `script` scope */
export const defaultHeuristicFuncOnly: HeuristicFunc = (txt, file) => {
    const defaultRes = defaultHeuristic(txt, file)
    if (defaultRes && txt.path.some(s => updatableScopes.has(s.type))) {
        return defaultRes
    }
    return false
}

export function newText(init: Partial<Text>): Text {
    init.body = init.body?.filter(str => str != null) ?? []
    if (init?.path?.at(-1)?.type === 'element') {
        init.body = init.body.map(str => str.replace(/\s+/g, ' ').trim())
    }
    return {
        body: init.body,
        placeholders: init.placeholders ?? [],
        type: init.type ?? 'message',
        context: init.context,
        path: init.path?.slice() ?? [], // copy because visitors .push and .pop
    }
}
