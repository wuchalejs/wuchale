// Shared logic between adapters for handling nested / mixed elements within elements / fragments

import type MagicString from "magic-string"
import { IndexTracker, Message, type HeuristicDetailsBase, type HeuristicFunc } from "../adapters.js"
import { commentPrefix, nonWhitespaceText, type RuntimeVars, type CommentDirectives } from "./index.js"

type NestedRanges = [number, number, boolean][]

type InitProps<NodeT> = {
    vars: () => RuntimeVars
    mstr: MagicString
    getRange: (node: NodeT) => { start: number, end: number }
    isText: (node: NodeT) => boolean
    isExpression: (node: NodeT) => boolean
    isComment: (node: NodeT) => boolean
    canHaveChildren: (node: NodeT) => boolean
    getTextContent: (node: NodeT) => string
    getCommentData: (node: NodeT) => string
    visitFunc: (node: NodeT, inCompoundText: boolean) => Message[]
    visitExpressionTag: (node: NodeT) => Message[]
    checkHeuristic: HeuristicFunc<HeuristicDetailsBase>
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
}

export interface MixedVisitor<NodeT> extends InitProps<NodeT> {}

export class MixedVisitor<NodeT> {

    constructor(props: InitProps<NodeT>) {
        Object.assign(this, props)
    }

    separatelyVisitChildren = (props: VisitProps<NodeT>): [boolean, boolean, boolean, Message[]] => {
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
                heurStr += strContent + ' '
            } else if (this.isComment(child)) {
                if (this.getCommentData(child).trim().startsWith(commentPrefix)) {
                    hasCommentDirectives = true
                }
            } else {
                hasNonTextChild = true
                heurStr += `# `
            }
        }
        heurStr = heurStr.trimEnd()
        const passHeuristic = this.checkHeuristic(heurStr, {
            scope: props.scope,
            element: props.element,
            attribute: props.attribute,
        })
        let hasCompoundText = hasTextChild && hasNonTextChild
        const visitAsOne = passHeuristic && !hasCommentDirectives
        if (props.inCompoundText || hasCompoundText && visitAsOne) {
            return [false, hasTextChild, hasCompoundText, []]
        }
        // can't be extracted as one; visit each separately if markup
        const msgs = []
        if (props.scope === 'markup') {
            for (const child of props.children) {
                msgs.push(...this.visitFunc(child, props.inCompoundText))
            }
        }
        return [true, false, false, msgs]
    }

    visit = (props: VisitProps<NodeT>): Message[] => {
        if (props.children.length === 0) {
            return []
        }
        const [visitedSeparately, hasTextChild, hasCompoundText, separateTxts] = this.separatelyVisitChildren(props)
        if (visitedSeparately) {
            return separateTxts
        }
        let msgStr = ''
        let iArg = 0
        let iTag = 0
        const lastChildEnd = this.getRange(props.children.slice(-1)[0]).end
        const childrenNestedRanges: NestedRanges = []
        let hasTextDescendants = false
        const msgs = []
        const comments: string[] = []
        for (const child of props.children) {
            if (this.isComment(child)) {
                continue
            }
            const chRange = this.getRange(child)
            if (this.isText(child)) {
                const [startWh, trimmed, endWh] = nonWhitespaceText(this.getTextContent(child))
                const msgInfo = new Message(trimmed, props.scope, props.commentDirectives.context)
                if (startWh && !msgStr.endsWith(' ')) {
                    msgStr += ' '
                }
                if (!trimmed) { // whitespace
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
                comments.push(`placeholder ${placeholder}: ${this.mstr.original.slice(chRange.start + 1, chRange.end - 1)}`)
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
            // elements, components and other things as well
            const canHaveChildren = this.canHaveChildren(child)
            const childMsgs = this.visitFunc(child, canHaveChildren)
            let nestedNeedsCtx = false
            let chTxt = ''
            for (const msgInfo of childMsgs) {
                if (canHaveChildren && msgInfo.scope === props.scope) {
                    chTxt += msgInfo.msgStr[0]
                    hasTextDescendants = true
                    nestedNeedsCtx = true
                } else { // attributes, blocks
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
        const msgInfo = new Message(msgStr, props.scope, props.commentDirectives.context)
        msgInfo.comments = comments
        if (hasTextChild || hasTextDescendants) {
            msgs.push(msgInfo)
        } else {
            return msgs
        }
        if (props.scope === 'markup' && iArg > 0 || childrenNestedRanges.length > 0) {
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
            this.mstr.appendLeft(lastChildEnd, begin)
            this.mstr.appendRight(lastChildEnd, end)
        }
        return msgs
    }
}
