// Shared logic between adapters for handling nested / mixed elements within elements / fragments

import type MagicString from 'magic-string'
import {
    type HeuristicDetails,
    type HeuristicDetailsBase,
    type HeuristicFunc,
    type IndexTracker,
    Message,
    type MessageType,
} from '../adapters.js'
import {
    type CommentDirectives,
    commentPrefix,
    nonWhitespaceText,
    type RuntimeVars,
    updateCommentDirectives,
} from './index.js'

type NestedRanges = [number, number, boolean][]

type InitProps<NodeT> = {
    vars: () => RuntimeVars
    mstr: MagicString
    getRange: (node: NodeT) => { start: number; end: number }
    isText: (node: NodeT) => boolean
    isExpression: (node: NodeT) => boolean
    isComment: (node: NodeT) => boolean
    leaveInPlace: (node: NodeT) => boolean
    canHaveChildren: (node: NodeT) => boolean
    getTextContent: (node: NodeT) => string
    getCommentData: (node: NodeT) => string
    visitFunc: (node: NodeT, inCompoundText: boolean) => Message[]
    visitExpressionTag: (node: NodeT) => Message[]
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

export interface MixedVisitor<NodeT> extends InitProps<NodeT> {}

type SeparateVisitRes = [boolean, boolean, boolean, MessageType, Message[]]

export class MixedVisitor<NodeT> {
    constructor(props: InitProps<NodeT>) {
        Object.assign(this, props)
    }

    separatelyVisitChildren = (props: VisitProps<NodeT>): SeparateVisitRes => {
        let hasTextChild = false
        let hasNonTextChild = false
        let heurStr = ''
        let hasCommentDirectives = false
        for (const child of props.children) {
            if (this.isText(child)) {
                const strContent = this.getTextContent(child)
                if (!strContent.trim()) {
                    continue
                }
                hasTextChild = true
                heurStr += strContent
            } else if (this.isComment(child)) {
                if (this.getCommentData(child).trim().startsWith(commentPrefix)) {
                    hasCommentDirectives = true
                }
            } else if (!this.leaveInPlace(child)) {
                hasNonTextChild = true
                heurStr += `#`
            }
        }
        heurStr = heurStr.trimEnd()
        const msg = new Message(
            heurStr,
            this.fullHeuristicDetails({
                scope: props.scope,
                element: props.element,
                attribute: props.attribute,
            }),
        )
        const heurMsgType = this.checkHeuristic(msg)
        if (heurMsgType) {
            const hasCompoundText = hasTextChild && hasNonTextChild
            if (props.inCompoundText || (hasCompoundText && !hasCommentDirectives)) {
                return [false, hasTextChild, hasCompoundText, heurMsgType, []]
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
            if (this.isComment(child)) {
                updateCommentDirectives(this.getCommentData(child), props.commentDirectives)
                lastVisitIsComment = true
                continue
            }
            if (this.isText(child) && !this.getTextContent(child).trim()) {
                continue
            }
            if (props.commentDirectives.ignoreFile) {
                break
            }
            if (props.commentDirectives.forceType !== false) {
                msgs.push(...this.visitFunc(child, props.inCompoundText))
            }
            if (!lastVisitIsComment) {
                continue
            }
            // restore. like Object.assign but in reverse for keys
            for (const key in props.commentDirectives) {
                props.commentDirectives[key] = commentDirectivesOrig[key]
            }
            lastVisitIsComment = false
        }
        return res
    }

    visit = (props: VisitProps<NodeT>): Message[] => {
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
        const lastChildEnd = this.getRange(props.children.slice(-1)[0]).end
        const childrenNestedRanges: NestedRanges = []
        let hasTextDescendants = false
        const msgs: Message[] = []
        const comments: string[] = []
        for (const child of props.children) {
            if (this.isComment(child)) {
                continue
            }
            const chRange = this.getRange(child)
            if (this.isText(child)) {
                const [startWh, trimmed, endWh] = nonWhitespaceText(this.getTextContent(child))
                const msgInfo = new Message(
                    trimmed,
                    this.fullHeuristicDetails({ scope: props.scope }),
                    props.commentDirectives.context,
                )
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
                this.mstr.remove(chRange.start, chRange.end)
                continue
            }
            if (this.isExpression(child)) {
                msgs.push(...this.visitExpressionTag(child))
                if (!hasCompoundText) {
                    continue
                }
                const placeholder = `{${iArg}}`
                msgStr += placeholder
                comments.push(
                    `placeholder ${placeholder}: ${this.mstr.original.slice(chRange.start + 1, chRange.end - 1)}`,
                )
                let moveStart = chRange.start
                if (iArg > 0) {
                    this.mstr.update(chRange.start, chRange.start + 1, ', ')
                } else {
                    moveStart++
                    this.mstr.remove(chRange.start, chRange.start + 1)
                }
                this.mstr.move(moveStart, chRange.end - 1, lastChildEnd)
                this.mstr.remove(chRange.end - 1, chRange.end)
                iArg++
                continue
            }
            if (this.leaveInPlace(child)) {
                msgs.push(...this.visitFunc(child, this.canHaveChildren(child)))
                continue
            }
            // elements, components and other things as well
            const canHaveChildren = this.canHaveChildren(child)
            const childMsgs = this.visitFunc(child, canHaveChildren)
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
        const msgInfo = new Message(
            msgStr,
            this.fullHeuristicDetails({ scope: props.scope }),
            props.commentDirectives.context,
        )
        msgInfo.type = heurMsgType
        msgInfo.comments = comments
        if (hasTextChild || hasTextDescendants) {
            msgs.push(msgInfo)
        } else {
            return msgs
        }
        if (((props.useComponent ?? true) && props.scope === 'markup' && iArg > 0) || childrenNestedRanges.length > 0) {
            this.wrapNested(msgInfo, iArg > 0, childrenNestedRanges, lastChildEnd)
        } else {
            // no need for component use
            let begin = '{'
            let end = ')}'
            if (props.inCompoundText) {
                begin += `${this.vars().rtTransCtx}(${this.vars().nestCtx}`
            } else {
                begin += `${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())}`
            }
            if (iArg > 0) {
                begin += ', ['
                end = ']' + end
            }
            if (props.scope === 'attribute' && `'"`.includes(this.mstr.original[lastChildEnd])) {
                const firstChild = props.children[0]
                const { start } = this.getRange(firstChild)
                this.mstr.remove(start - 1, start)
                this.mstr.remove(lastChildEnd, lastChildEnd + 1)
            }
            this.mstr.appendLeft(lastChildEnd, begin)
            this.mstr.appendRight(lastChildEnd, end)
        }
        return msgs
    }
}
