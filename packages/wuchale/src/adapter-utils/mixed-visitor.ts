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
type Range = { start: number; end: number }
type Nums = { text: number; expr: number; element: number; comment: number }

type InitProps<MixNodeT, TxtT extends MixNodeT, ComT extends MixNodeT, ExprT extends MixNodeT> = {
    mstr: MagicString
    index: IndexTracker
    content: string
    vars: () => RuntimeVars
    getRange: (node: MixNodeT) => Range
    isText: (node: MixNodeT) => node is TxtT
    isExpression: (node: MixNodeT) => node is ExprT
    isComment: (node: MixNodeT) => node is ComT
    leaveInPlace: (node: MixNodeT) => boolean
    canHaveChildren: (node: MixNodeT) => boolean
    getTextContent: (node: TxtT) => string
    getCommentData: (node: ComT) => string
    visitFunc: (node: MixNodeT) => Message[]
    fullHeuristicDetails: (details: HeuristicDetailsBase) => HeuristicDetails
    checkHeuristic: HeuristicFunc
    wrapNested: (
        inNested: boolean,
        msgInfo: Message,
        hasExpr: boolean,
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
    noNest: boolean
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
    noNest: false,
    pending: true,
    funcs: [],
    children: [],
})

type TrimOut = [number, string, number]

/** trims from end first */
function trimText(msgStr: string): TrimOut {
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

    #applyMod(mod: LevelMod, depth = 0) {
        if (!mod.pending) {
            return []
        }
        if (mod.noNest) {
            depth = 0
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
                    }
                }
                modify && msgs.push(mod.msg)
            }
            if (!modify) {
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
            const [, , endWh] = trimText(this.#props.getTextContent(lastChild))
            return lastChildEnd - endWh
        }
        return lastChildEnd
    }

    #makeMsg(props: VisitProps<MixNodeT>, msgStr: string, placeholders: [string, string][] = []) {
        return newMessage({
            msgStr: [msgStr.trim()],
            details: this.#props.fullHeuristicDetails({
                scope: props.scope,
                element: props.element,
                attribute: props.attribute,
            }),
            context: props.commentDirectives.context,
            placeholders,
        })
    }

    #childNums(children: MixNodeT[]): Nums {
        const nums: Nums = { text: 0, expr: 0, element: 0, comment: 0 }
        for (const child of children) {
            if (this.#props.isText(child)) {
                if (this.#props.getTextContent(child).trim()) {
                    nums.text++
                }
            } else if (this.#props.isExpression(child)) {
                nums.expr++
            } else if (this.#props.isComment(child)) {
                nums.comment++
            } else {
                nums.element++
            }
        }
        return nums
    }

    #text(mod: LevelMod, props: VisitProps<MixNodeT>, trimOut: TrimOut, range: Range, nums: Nums) {
        const [startWh, trimmed, endWh] = trimOut
        mod.hasTxtDesc = true
        const msg = this.#makeMsg(props, trimmed)
        let { start, end } = range
        mod.txts.push([
            msg,
            () => {
                const index = this.#props.index.get(getKey(msg.msgStr, msg.context))
                this.#props.mstr.update(start + startWh, end - endWh, `{${this.#props.vars().rtTrans}(${index})}`)
            },
        ])
        mod.funcs.push(nested => {
            if (!nested && nums.text === 1 && nums.element === 0 && nums.expr === 0) {
                start += startWh
                end -= endWh
            }
            this.#props.mstr.remove(start, end)
        })
        if (endWh) {
            return `${trimmed} `
        }
        return trimmed
    }

    #expression(funcs: ModFunc[], range: Range, iArg: number, placeholders: [string, string][], lastChildEnd: number) {
        const start = range.start + 1
        const end = range.end - 1
        placeholders.push([iArg.toString(), this.#props.content.slice(start, end)])
        const firstOne = iArg === 0
        funcs.push(() => {
            let moveStart = range.start
            if (firstOne) {
                moveStart++
                this.#props.mstr.remove(range.start, start)
            } else {
                this.#props.mstr.update(range.start, start, ', ')
            }
            this.#props.mstr.move(moveStart, end, lastChildEnd)
            this.#props.mstr.remove(end, range.end)
        })
        return `{${iArg}}`
    }

    #finalMod(
        props: VisitProps<MixNodeT>,
        msg: Message,
        lastChildEnd: number,
        childrenNestedRanges: [number, number, boolean][],
        hasExpr: boolean,
        nums: Nums,
    ): ModFunc {
        const vars = this.#props.vars()
        return nested => {
            if (
                ((props.useComponent ?? true) && props.scope === 'markup' && hasExpr) ||
                childrenNestedRanges.length > 0
            ) {
                if (nums.element + nums.text + nums.expr > 1) {
                    this.#props.wrapNested(nested, msg, hasExpr, childrenNestedRanges, lastChildEnd)
                }
                return
            }
            // no need for component use
            let begin = '{'
            let end = ')}'
            if (nested) {
                begin += `${vars.rtTransCtx}(${vars.nestCtx}`
            } else {
                if (msg.type === 'url') {
                    begin += `${varNames.urlLocalize}(`
                    end = `), ${vars.rtLocale}${end}`
                }
                const index = this.#props.index.get(getKey(msg.msgStr, msg.context))
                begin += `${vars.rtTrans}(${index}`
            }
            if (hasExpr) {
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
        }
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
        const alreadyInsideUnit = props.commentDirectives.unit ?? false
        const mod = this.#mod[props.scope]
        const nums = this.#childNums(props.children)
        mod.building ||= alreadyInsideUnit || nums.text > 0
        if (props.addMod) {
            mod.funcs.push(props.addMod)
        }
        const exprFuncs: ModFunc[] = []
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
                const trimOut = trimText(this.#props.getTextContent(child))
                const [startWh, trimmed] = trimOut
                if ((startWh || trimmed === '') && !msgStr.endsWith(' ')) {
                    msgStr += ' '
                }
                if (!trimmed) {
                    // whitespace
                    continue
                }
                if (props.commentDirectives.forceType !== false) {
                    mod.hasTxtDesc = true
                    msgStr += this.#text(mod, props, trimOut, chRange, nums)
                }
            } else if (props.commentDirectives.forceType !== false) {
                if (this.#props.leaveInPlace(child)) {
                    msgs.push(...this.#props.visitFunc(child))
                } else if (this.#props.isExpression(child)) {
                    msgs.push(...this.#props.visitFunc(child))
                    if (nums.text > 0 || nums.element > 0) {
                        msgStr += this.#expression(exprFuncs, chRange, iArg, placeholders, lastChildEnd)
                        iArg++
                    }
                } else {
                    // elements, components and other things as well
                    const canHaveChildren = this.#props.canHaveChildren(child)
                    const childMod = newMod(
                        canHaveChildren && mod.building,
                        !alreadyInsideUnit && props.commentDirectives.unit,
                    )
                    this.#mod[props.scope] = childMod
                    msgs.push(...this.#props.visitFunc(child))
                    this.#mod[props.scope] = mod
                    mod.children.push(childMod)
                    let nestedNeedsCtx = false
                    let chTxt = `<${iTag}/>`
                    if (canHaveChildren) {
                        mod.hasTxtDesc ||= childMod.hasTxtDesc
                        if (childMod.msg) {
                            if (nums.element === 1 && nums.expr === 0 && nums.text === 0) {
                                chTxt = childMod.msg.msgStr[0]!
                                placeholders.push(...childMod.msg.placeholders)
                            } else if (childMod.hasTxtDesc) {
                                chTxt = `<${iTag}>${childMod.msg.msgStr[0]!}</${iTag}>`
                                for (const [num, cont] of childMod.msg.placeholders) {
                                    placeholders.push([`${iTag}.${num}`, cont])
                                }
                                nestedNeedsCtx = true
                            }
                        }
                    } else {
                        childMod.noNest = true
                    }
                    childrenNestedRanges.push([chRange.start, chRange.end, nestedNeedsCtx])
                    msgStr += chTxt
                    iTag++
                }
            }
            if (!lastVisitIsComment) {
                continue
            }
            restoreCommentDirectives(props.commentDirectives, commentDirectivesOrig)
            lastVisitIsComment = false
        }
        const msg = this.#makeMsg(props, msgStr, placeholders)
        if (!hasCommentDirectives) {
            mod.msg = msg // can be taken together
        }
        if (mod.hasTxtDesc) {
            mod.funcs.push(...exprFuncs, this.#finalMod(props, msg, lastChildEnd, childrenNestedRanges, iArg > 0, nums))
        }
        if (mod.unit || !mod.building || hasCommentDirectives) {
            msgs.push(...this.applyMod(props.scope))
        }
        return msgs
    }
}
