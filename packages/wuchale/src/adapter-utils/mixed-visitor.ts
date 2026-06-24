// Shared logic between adapters for handling nested / mixed elements within elements / fragments

import type MagicString from 'magic-string'
import {
    getKey,
    type HeuristicDetails,
    type HeuristicDetailsBase,
    type HeuristicFunc,
    type IndexTracker,
    type Message,
    newMessage,
} from '../adapters.js'
import {
    type CommentDirectives,
    commentPrefix,
    type RuntimeVars,
    restoreCommentDirectives,
    updateCommentDirectives,
    varNames,
} from './index.js'

type NestedRanges = [number, number, boolean][]

type InitProps<MixNodeT, TxtT extends MixNodeT, ComT extends MixNodeT, ExprT extends MixNodeT> = {
    mstr: MagicString
    index: IndexTracker
    content: string
    vars: () => RuntimeVars
    getRange: (node: MixNodeT) => { start: number; end: number }
    isText: (node: MixNodeT) => node is TxtT
    isExpression: (node: MixNodeT) => node is ExprT
    isComment: (node: MixNodeT) => node is ComT
    leaveInPlace: (node: MixNodeT) => boolean
    getTextContent: (node: TxtT) => string
    getCommentData: (node: ComT) => string
    visitFunc: (node: MixNodeT) => Message[]
    fullHeuristicDetails: (details: HeuristicDetailsBase) => HeuristicDetails
    checkHeuristic: HeuristicFunc
    wrapNested: (
        inNested: boolean,
        msgInfo: Message,
        hasExprs: boolean,
        nestedRanges: NestedRanges,
        lastChildEnd: number,
    ) => void
}

export type MixedScope = 'markup' | 'attribute'

export type ModFunc = (nested: boolean) => void

type LevelMod = {
    msg: Message | null
    txts: [Message, () => void][]
    hasTxtDesc: boolean
    unit: boolean
    pending: boolean
    building: boolean
    funcs: ModFunc[]
    children: LevelMod[]
}

const newMod = (building = false, unit = false): LevelMod => ({
    msg: null,
    hasTxtDesc: false,
    txts: [],
    building,
    unit,
    pending: true,
    funcs: [],
    children: [],
})

/** trims from end first */
function nonWhitespaceText(msgStr: string): [number, string, number] {
    const trimmedE = msgStr.trimEnd()
    const endWh = msgStr.length - trimmedE.length
    const trimmed = trimmedE.trimStart()
    const startWh = trimmedE.length - trimmed.length
    return [startWh, trimmed, endWh]
}

type VisitProps<NodeT> = {
    children: NodeT[]
    commentDirectives: CommentDirectives
    scope: MixedScope
    element: string
    attribute?: string
    /** force using component instead of a function call.
     * set to true when variables can be objects that cannot be converted to strings like
     * e.g. components in jsx to prevent `[object Object]` being rendered. */
    useComponent?: boolean
    /** additional modify func to call */
    addMod?: ModFunc | undefined
}

export class MixedVisitor<
    MixNodeT extends object,
    TxtT extends MixNodeT,
    ComT extends MixNodeT,
    ExprT extends MixNodeT,
> {
    #props: InitProps<MixNodeT, TxtT, ComT, ExprT>
    #mod = { markup: newMod(), attribute: newMod() }

    constructor(props: InitProps<MixNodeT, TxtT, ComT, ExprT>) {
        this.#props = props
    }

    /** apply pending nested message edits */
    #applyMod(mod: LevelMod, depth = 0) {
        if (!mod.pending) {
            return []
        }
        const msgs: Message[] = []
        const nested = depth > 0
        let modify = nested
        if (!nested) {
            if (mod.msg) {
                if (mod.unit) {
                    mod.msg.type = 'message'
                    modify = true
                } else if (mod.building) {
                    const heurMsgType = this.#props.checkHeuristic(mod.msg)
                    if (heurMsgType) {
                        mod.msg.type = heurMsgType
                        modify = true
                    } else {
                        modify = false
                    }
                }
                modify && msgs.push(mod.msg)
            } else {
                for (const [msg, func] of mod.txts) {
                    const heurMsgType = this.#props.checkHeuristic(msg)
                    if (!heurMsgType) {
                        continue
                    }
                    msg.type = heurMsgType
                    msgs.push(msg)
                    func()
                }
            }
        }
        if (modify) {
            for (const func of mod.funcs) {
                func(nested)
            }
        }
        for (const childMod of mod.children) {
            msgs.push(...this.#applyMod(childMod, depth + (modify ? 1 : 0)))
        }
        mod.pending = false
        return msgs
    }

    applyMod(scope: MixedScope = 'markup') {
        const mod = this.#mod[scope]
        const msgs = this.#applyMod(mod)
        this.#mod[scope] = newMod() // in addition to pending for when called for last cleanup
        return msgs
    }

    #getLastChildEnd(children: MixNodeT[]): number {
        const lastChild = children.slice(-1)[0]!
        const lastChildEnd = this.#props.getRange(lastChild).end
        if (this.#props.isText(lastChild)) {
            const [, , endWh] = nonWhitespaceText(this.#props.getTextContent(lastChild))
            return lastChildEnd - endWh
        }
        return lastChildEnd
    }

    visit(props: VisitProps<MixNodeT>) {
        if (props.children.length === 0) {
            return []
        }
        let hasCommentDirectives = false
        let msgStr = ''
        let iArg = 0
        let iTag = 0
        const commentDirectivesOrig: CommentDirectives = { ...props.commentDirectives }
        let lastVisitIsComment = false
        const lastChildEnd = this.#getLastChildEnd(props.children)
        const childrenNestedRanges: NestedRanges = []
        const msgs: Message[] = []
        const placeholders: [string, string][] = []
        const vars = this.#props.vars()
        const alreadyInsideUnit = props.commentDirectives.unit ?? false
        const mod = this.#mod[props.scope]
        mod.building ||=
            alreadyInsideUnit ||
            props.children.find(c => this.#props.isText(c) && this.#props.getTextContent(c).trim()) != null
        if (props.addMod) {
            mod.funcs.push(props.addMod)
        }
        for (const child of props.children) {
            if (this.#props.isComment(child)) {
                const data = this.#props.getCommentData(child)
                if (data.trim().startsWith(commentPrefix)) {
                    updateCommentDirectives(data, props.commentDirectives)
                    hasCommentDirectives = true
                }
                lastVisitIsComment = true
                continue
            }
            if (props.commentDirectives.ignoreFile) {
                return []
            }
            const chRange = this.#props.getRange(child)
            if (this.#props.isText(child)) {
                const [startWh, trimmed, endWh] = nonWhitespaceText(this.#props.getTextContent(child))
                if ((startWh || trimmed === '') && !msgStr.endsWith(' ')) {
                    msgStr += ' '
                }
                if (!trimmed) {
                    // whitespace
                    continue
                }
                if (props.commentDirectives.forceType !== false) {
                    mod.hasTxtDesc = true
                    msgStr += trimmed
                    if (endWh) {
                        msgStr += ' '
                    }
                    let start = chRange.start
                    let end = chRange.end
                    const msg = newMessage({
                        msgStr: [trimmed],
                        details: this.#props.fullHeuristicDetails({
                            scope: props.scope,
                            element: props.element,
                            attribute: props.attribute,
                        }),
                        context: props.commentDirectives.context,
                    })
                    mod.txts.push([
                        msg,
                        () => {
                            const index = this.#props.index.get(getKey(msg.msgStr, msg.context))
                            this.#props.mstr.update(start + startWh, end - endWh, `{${vars.rtTrans}(${index})}`)
                        },
                    ])
                    mod.funcs.push(nested => {
                        if (!nested && props.children.length === 1) {
                            start += startWh
                            end -= endWh
                        }
                        this.#props.mstr.remove(start, end)
                    })
                }
            } else if (props.commentDirectives.forceType !== false) {
                if (this.#props.leaveInPlace(child)) {
                    msgs.push(...this.#props.visitFunc(child))
                    continue
                }
                if (this.#props.isExpression(child)) {
                    msgs.push(...this.#props.visitFunc(child))
                    msgStr += `{${iArg}}`
                    const start = chRange.start + 1
                    const end = chRange.end - 1
                    placeholders.push([iArg.toString(), this.#props.content.slice(start, end)])
                    const firstOne = iArg === 0
                    mod.funcs.push(() => {
                        let moveStart = chRange.start
                        if (firstOne) {
                            moveStart++
                            this.#props.mstr.remove(chRange.start, start)
                        } else {
                            this.#props.mstr.update(chRange.start, start, ', ')
                        }
                        this.#props.mstr.move(moveStart, end, lastChildEnd)
                        this.#props.mstr.remove(end, chRange.end)
                    })
                    iArg++
                    continue
                }
                // elements, components and other things as well
                const childMod = newMod(mod.building, !alreadyInsideUnit && props.commentDirectives.unit)
                this.#mod[props.scope] = childMod
                const childMsgs = this.#props.visitFunc(child)
                this.#mod[props.scope] = mod
                mod.children.push(childMod)
                if (childMod.hasTxtDesc) {
                    mod.hasTxtDesc = true
                }
                msgs.push(...childMsgs)
                let nestedNeedsCtx = false
                let chTxt = `<${iTag}/>`
                if (childMod.msg) {
                    if (props.children.length === 1) {
                        chTxt = childMod.msg.msgStr[0]!
                        placeholders.push(...childMod.msg.placeholders)
                    } else if (childMod.hasTxtDesc) {
                        chTxt = `<${iTag}>${childMod.msg.msgStr[0]!}</${iTag}>`
                        for (const [num, cont] of childMod.msg.placeholders) {
                            placeholders.push([`${iTag}.${num}`, cont])
                        }
                        nestedNeedsCtx = true
                    }
                    childrenNestedRanges.push([chRange.start, chRange.end, nestedNeedsCtx])
                }
                msgStr += chTxt
                iTag++
            }
            if (!lastVisitIsComment) {
                continue
            }
            restoreCommentDirectives(props.commentDirectives, commentDirectivesOrig)
            lastVisitIsComment = false
        }
        const msgInfo = newMessage({
            msgStr: [msgStr.trim()],
            details: this.#props.fullHeuristicDetails({
                scope: props.scope,
                element: props.element,
                attribute: props.attribute,
            }),
            context: props.commentDirectives.context,
            placeholders,
        })
        if (!hasCommentDirectives) {
            // can be taken together
            mod.msg = msgInfo
            mod.txts = []
        }
        mod.funcs.push(nested => {
            if (!mod.hasTxtDesc) {
                return
            }
            if (
                ((props.useComponent ?? true) && props.scope === 'markup' && iArg > 0) ||
                childrenNestedRanges.length > 0
            ) {
                if (props.children.length > 1) {
                    this.#props.wrapNested(nested, msgInfo, iArg > 0, childrenNestedRanges, lastChildEnd)
                }
                return
            }
            // no need for component use
            let begin = '{'
            let end = ')}'
            if (nested) {
                begin += `${vars.rtTransCtx}(${vars.nestCtx}`
            } else {
                if (msgInfo.type === 'url') {
                    begin += `${varNames.urlLocalize}(`
                    end = `), ${vars.rtLocale}${end}`
                }
                const index = this.#props.index.get(getKey(msgInfo.msgStr, msgInfo.context))
                begin += `${vars.rtTrans}(${index}`
            }
            if (iArg > 0) {
                begin += ', ['
                end = `]${end}`
            }
            if (props.scope === 'attribute' && `'"`.includes(this.#props.content[lastChildEnd]!)) {
                const firstChild = props.children[0]!
                const { start } = this.#props.getRange(firstChild)
                this.#props.mstr.remove(start - 1, start)
                this.#props.mstr.remove(lastChildEnd, lastChildEnd + 1)
            }
            this.#props.mstr.appendLeft(lastChildEnd, begin)
            this.#props.mstr.appendRight(lastChildEnd, end)
        })
        if (mod.unit || !mod.building || hasCommentDirectives) {
            msgs.push(...this.applyMod(props.scope))
        }
        return msgs
    }
}
