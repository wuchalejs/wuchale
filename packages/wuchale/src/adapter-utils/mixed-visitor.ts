// Shared logic between adapters for handling nested / mixed elements within elements / fragments

import type MagicString from 'magic-string'
import {
    getKey,
    type HeuristicDetails,
    type HeuristicDetailsBase,
    type HeuristicFunc,
    type IndexTracker,
    type Message,
    type MessageType,
    newMessage,
} from '../adapters.js'
import {
    type CommentDirectives,
    commentPrefix,
    nonWhitespaceText,
    type RuntimeVars,
    restoreCommentDirectives,
    updateCommentDirectives,
    varNames,
} from './index.js'

type NestedRanges = [number, number, boolean][]

type InitProps<MixNodeT, TxtT extends MixNodeT, ComT extends MixNodeT, ExprT extends MixNodeT> = {
    vars: () => RuntimeVars
    mstr: MagicString
    getRange: (node: MixNodeT) => { start: number; end: number }
    isText: (node: MixNodeT) => node is TxtT
    isExpression: (node: MixNodeT) => node is ExprT
    isComment: (node: MixNodeT) => node is ComT
    leaveInPlace: (node: MixNodeT) => boolean
    canHaveChildren: (node: MixNodeT) => boolean
    getTextContent: (node: TxtT) => string
    getCommentData: (node: ComT) => string
    visitFunc: (node: MixNodeT, inCompoundText: boolean) => Message[]
    visitExpressionTag: (node: ExprT) => Message[]
    fullHeuristicDetails: (details: HeuristicDetailsBase) => HeuristicDetails
    checkHeuristic: HeuristicFunc
    wrapNested: (msgInfo: Message, hasExprs: boolean, nestedRanges: NestedRanges, lastChildEnd: number) => void
    index: IndexTracker
}

export type MixedScope = 'markup' | 'attribute'

type VisitProps<NodeT> = {
    children: NodeT[]
    commentDirectives: CommentDirectives
    inCompoundText: boolean
    scope: MixedScope
    element: string
    attribute?: string
    /** force using component instead of a function call.
     * set to true when variables can be objects that cannot be converted to strings like
     * e.g. components in jsx to prevent `[object Object]` being rendered. */
    useComponent?: boolean
}

type SeparateVisitRes = [boolean, boolean, boolean, MessageType, Message[]]

export class MixedVisitor<MixNodeT, TxtT extends MixNodeT, ComT extends MixNodeT, ExprT extends MixNodeT> {
    #props: InitProps<MixNodeT, TxtT, ComT, ExprT>

    constructor(props: InitProps<MixNodeT, TxtT, ComT, ExprT>) {
        this.#props = props
    }

    separatelyVisitChildren = (props: VisitProps<MixNodeT>): SeparateVisitRes => {
        let hasTextChild = false
        let hasNonTextChild = false
        let heurStr = ''
        let hasCommentDirectives = false
        for (const child of props.children) {
            if (this.#props.isText(child)) {
                const strContent = this.#props.getTextContent(child)
                if (!strContent.trim()) {
                    continue
                }
                hasTextChild = true
                heurStr += strContent
            } else if (this.#props.isComment(child)) {
                if (this.#props.getCommentData(child).trim().startsWith(commentPrefix)) {
                    hasCommentDirectives = true
                }
            } else if (!this.#props.leaveInPlace(child)) {
                hasNonTextChild = true
                heurStr += `#`
            }
        }
        heurStr = heurStr.trimEnd()
        const msg = newMessage({
            msgStr: [heurStr],
            details: this.#props.fullHeuristicDetails({
                scope: props.scope,
                element: props.element,
                attribute: props.attribute,
            }),
        })
        const heurMsgType = this.#props.checkHeuristic(msg)
        if (heurMsgType || props.commentDirectives.unit) {
            const hasCompoundText = hasTextChild && hasNonTextChild
            if (props.inCompoundText || props.commentDirectives.unit || (hasCompoundText && !hasCommentDirectives)) {
                return [false, hasTextChild, hasCompoundText, heurMsgType || 'message', []]
            }
        }
        // can't be extracted as one; visit each separately if markup
        const msgs: Message[] = []
        const res: SeparateVisitRes = [true, false, false, heurMsgType || 'message', msgs]
        if (props.scope !== 'markup') {
            return res
        }
        const commentDirectivesOrig: CommentDirectives = { ...props.commentDirectives }
        let lastVisitIsComment = false
        for (const child of props.children) {
            if (this.#props.isComment(child)) {
                updateCommentDirectives(this.#props.getCommentData(child), props.commentDirectives)
                lastVisitIsComment = true
                continue
            }
            if (this.#props.isText(child) && !this.#props.getTextContent(child).trim()) {
                continue
            }
            if (props.commentDirectives.ignoreFile) {
                break
            }
            if (props.commentDirectives.forceType !== false) {
                msgs.push(...this.#props.visitFunc(child, props.inCompoundText))
            }
            if (!lastVisitIsComment) {
                continue
            }
            restoreCommentDirectives(props.commentDirectives, commentDirectivesOrig)
            lastVisitIsComment = false
        }
        return res
    }

    visit = (props: VisitProps<MixNodeT>): Message[] => {
        if (props.children.length === 0) {
            return []
        }
        const [visitedSeparately, hasTextChild, hasCompoundText, heurMsgType, separateTxts] =
            this.separatelyVisitChildren(props)
        if (visitedSeparately) {
            return separateTxts
        }
        let msgStr = ''
        let iArg = 0
        let iTag = 0
        const lastChildEnd = this.#props.getRange(props.children.slice(-1)[0]!).end
        const childrenNestedRanges: NestedRanges = []
        let hasTextDescendants = false
        const msgs: Message[] = []
        const placeholders: [number, string][] = []
        for (const child of props.children) {
            if (this.#props.isComment(child)) {
                continue
            }
            const chRange = this.#props.getRange(child)
            if (this.#props.isText(child)) {
                const [startWh, trimmed, endWh] = nonWhitespaceText(this.#props.getTextContent(child))
                const msgInfo = newMessage({
                    msgStr: [trimmed],
                    details: this.#props.fullHeuristicDetails({ scope: props.scope }),
                    context: props.commentDirectives.context,
                })
                if (startWh && !msgStr.endsWith(' ')) {
                    msgStr += ' '
                }
                if (!trimmed) {
                    // whitespace
                    continue
                }
                msgStr += msgInfo.msgStr
                if (endWh) {
                    msgStr += ' '
                }
                this.#props.mstr.remove(chRange.start, chRange.end)
                continue
            }
            if (this.#props.isExpression(child)) {
                msgs.push(...this.#props.visitExpressionTag(child))
                if (!hasCompoundText) {
                    continue
                }
                msgStr += `{${iArg}}`
                placeholders.push([iArg, this.#props.mstr.original.slice(chRange.start + 1, chRange.end - 1)])
                let moveStart = chRange.start
                if (iArg > 0) {
                    this.#props.mstr.update(chRange.start, chRange.start + 1, ', ')
                } else {
                    moveStart++
                    this.#props.mstr.remove(chRange.start, chRange.start + 1)
                }
                this.#props.mstr.move(moveStart, chRange.end - 1, lastChildEnd)
                this.#props.mstr.remove(chRange.end - 1, chRange.end)
                iArg++
                continue
            }
            if (this.#props.leaveInPlace(child)) {
                msgs.push(...this.#props.visitFunc(child, this.#props.canHaveChildren(child)))
                continue
            }
            // elements, components and other things as well
            const canHaveChildren = this.#props.canHaveChildren(child)
            const childMsgs = this.#props.visitFunc(child, canHaveChildren)
            let nestedNeedsCtx = false
            let chTxt = ''
            for (const msgInfo of childMsgs) {
                if (canHaveChildren && msgInfo.details.scope === props.scope) {
                    chTxt += msgInfo.msgStr[0]
                    hasTextDescendants = true
                    nestedNeedsCtx = true
                } else {
                    // attributes, blocks
                    msgs.push(msgInfo)
                }
            }
            childrenNestedRanges.push([chRange.start, chRange.end, nestedNeedsCtx])
            if (canHaveChildren && chTxt) {
                chTxt = `<${iTag}>${chTxt}</${iTag}>`
            } else {
                // childless elements and everything else
                chTxt = `<${iTag}/>`
            }
            iTag++
            msgStr += chTxt
        }
        msgStr = msgStr.trim()
        if (!msgStr) {
            return msgs
        }
        const msgInfo = newMessage({
            msgStr: [msgStr],
            details: this.#props.fullHeuristicDetails({ scope: props.scope }),
            context: props.commentDirectives.context,
        })
        msgInfo.type = heurMsgType
        msgInfo.placeholders = placeholders
        if (hasTextChild || hasTextDescendants) {
            msgs.push(msgInfo)
        } else {
            return msgs
        }
        if (((props.useComponent ?? true) && props.scope === 'markup' && iArg > 0) || childrenNestedRanges.length > 0) {
            this.#props.wrapNested(msgInfo, iArg > 0, childrenNestedRanges, lastChildEnd)
        } else {
            // no need for component use
            let begin = '{'
            let end = ')}'
            if (props.inCompoundText) {
                begin += `${this.#props.vars().rtTransCtx}(${this.#props.vars().nestCtx}`
            } else {
                if (msgInfo.type === 'url') {
                    begin += `${varNames.urlLocalize}(`
                    end = `), ${this.#props.vars().rtLocale}${end}`
                }
                begin += `${this.#props.vars().rtTrans}(${this.#props.index.get(getKey(msgInfo.msgStr, msgInfo.context))}`
            }
            if (iArg > 0) {
                begin += ', ['
                end = `]${end}`
            }
            if (props.scope === 'attribute' && `'"`.includes(this.#props.mstr.original[lastChildEnd]!)) {
                const firstChild = props.children[0]!
                const { start } = this.#props.getRange(firstChild)
                this.#props.mstr.remove(start - 1, start)
                this.#props.mstr.remove(lastChildEnd, lastChildEnd + 1)
            }
            this.#props.mstr.appendLeft(lastChildEnd, begin)
            this.#props.mstr.appendRight(lastChildEnd, end)
        }
        return msgs
    }
}
