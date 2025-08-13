// Shared logic between adapters for handling nested / mixed elements within elements / fragments

import type MagicString from "magic-string"
import { IndexTracker, NestText, type CommentDirectives } from "../adapters.js"
import { nonWhitespaceText, type RuntimeVars } from "./index.js"

type NestedRanges = [number, number, boolean][]

type InitProps<NodeT> = {
    mstr: MagicString
    getRange: (node: NodeT) => { start: number, end: number }
    isText: (node: NodeT) => boolean
    isExpression: (node: NodeT) => boolean
    isComment: (node: NodeT) => boolean
    canHaveChildren: (node: NodeT) => boolean
    getTextContent: (node: NodeT) => string
    getCommentData: (node: NodeT) => string
    visitFunc: (node: NodeT, inCompoundText: boolean) => NestText[]
    visitExpressionTag: (node: NodeT) => NestText[]
    checkHeuristic: (txt: string) => boolean
    wrapNested: (txt: NestText, hasExprs: boolean, nestedRanges: NestedRanges, lastChildEnd: number) => void
    index: IndexTracker
    vars: RuntimeVars
}

type VisitProps<NodeT> = {
    children: NodeT[]
    commentDirectives: CommentDirectives
    inCompoundText: boolean
}

export interface MixedVisitor<NodeT> extends InitProps<NodeT> {}

export class MixedVisitor<NodeT> {

    constructor(props: InitProps<NodeT>) {
        Object.assign(this, props)
    }

    separatelyVisitChildren = (props: VisitProps<NodeT>): [boolean, boolean, boolean, NestText[]] => {
        let hasTextChild = false
        let hasNonTextChild = false
        let heurTxt = ''
        let hasCommentDirectives = false
        for (const child of props.children) {
            if (this.isText(child)) {
                const text = this.getTextContent(child)
                const txt = text.trim()
                if (!txt) {
                    continue
                }
                hasTextChild = true
                heurTxt += text + ' '
            } else if (this.isComment(child)) {
                if (this.getCommentData(child).trim().startsWith('@wc-')) {
                    hasCommentDirectives = true
                }
            } else {
                hasNonTextChild = true
                heurTxt += `# `
            }
        }
        heurTxt = heurTxt.trimEnd()
        const passHeuristic = this.checkHeuristic(heurTxt)
        let hasCompoundText = hasTextChild && hasNonTextChild
        const visitAsOne = passHeuristic && !hasCommentDirectives
        if (props.inCompoundText || hasCompoundText && visitAsOne) {
            return [false, hasTextChild, hasCompoundText, []]
        }
        const txts = []
        // can't be extracted as one; visitSv each separately
        for (const child of props.children) {
            txts.push(...this.visitFunc(child, props.inCompoundText))
        }
        return [true, false, false, txts]
    }

    visit = (props: VisitProps<NodeT>): NestText[] => {
        if (props.children.length === 0) {
            return []
        }
        const [visitedSeparately, hasTextChild, hasCompoundText, separateTxts] = this.separatelyVisitChildren(props)
        if (visitedSeparately) {
            return separateTxts
        }
        let txt = ''
        let iArg = 0
        let iTag = 0
        const lastChildEnd = this.getRange(props.children.slice(-1)[0]).end
        const childrenNestedRanges: NestedRanges = []
        let hasTextDescendants = false
        const txts = []
        for (const child of props.children) {
            if (this.isComment(child)) {
                continue
            }
            const chRange = this.getRange(child)
            if (this.isText(child)) {
                const [startWh, trimmed, endWh] = nonWhitespaceText(this.getTextContent(child))
                const nTxt = new NestText(trimmed, 'markup', props.commentDirectives.context)
                if (startWh && !txt.endsWith(' ')) {
                    txt += ' '
                }
                if (!trimmed) { // whitespace
                    continue
                }
                txt += nTxt.text
                if (endWh) {
                    txt += ' '
                }
                this.mstr.remove(chRange.start, chRange.end)
                continue
            }
            if (this.isExpression(child)) {
                txts.push(...this.visitExpressionTag(child))
                if (!hasCompoundText) {
                    continue
                }
                txt += `{${iArg}}`
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
            const childTxts = this.visitFunc(child, canHaveChildren)
            let nestedNeedsCtx = false
            let chTxt = ''
            for (const txt of childTxts) {
                if (canHaveChildren && txt.scope === 'markup') {
                    chTxt += txt.text[0]
                    hasTextDescendants = true
                    nestedNeedsCtx = true
                } else { // attributes, blocks
                    txts.push(txt)
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
            txt += chTxt
        }
        txt = txt.trim()
        if (!txt) {
            return txts
        }
        const nTxt = new NestText(txt, 'markup', props.commentDirectives.context)
        if (hasTextChild || hasTextDescendants) {
            txts.push(nTxt)
        } else {
            return txts
        }
        if (childrenNestedRanges.length) {
            this.wrapNested(nTxt, iArg > 0, childrenNestedRanges, lastChildEnd)
        } else if (hasTextChild) {
            // no need for component use
            let begin = '{'
            let end = ')}'
            if (props.inCompoundText) {
                begin += `${this.vars.rtTransCtx}(${this.vars.nestCtx}`
            } else {
                begin += `${this.vars.rtTrans}(${this.index.get(nTxt.toKey())}`
            }
            if (iArg > 0) {
                begin += ', ['
                end = ']' + end
            }
            this.mstr.appendLeft(lastChildEnd, begin)
            this.mstr.appendRight(lastChildEnd, end)
        }
        return txts
    }
}
