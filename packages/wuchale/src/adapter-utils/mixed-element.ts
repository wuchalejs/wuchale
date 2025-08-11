// Shared logic between adapters for handling nested / mixed elements within elements / fragments

import type MagicString from "magic-string"
import { IndexTracker, NestText, type CommentDirectives } from "../adapters.js"
import { nonWhitespaceText, varNames } from "./utils.js"

type NestedRanges = [number, number, boolean][]
export type WrapNestedFunc = (txt: NestText, hasExprs: boolean, nestedRanges: NestedRanges, lastChildEnd: number) => void
export type VisitForNested<NodeT> = (node: NodeT, inCompoundText: boolean) => NestText[]

type VisitProps<NodeT> = {
    children: NodeT[]
    mstr: MagicString
    getRange: (node: NodeT) => { start: number, end: number }
    isText: (node: NodeT) => boolean
    isExpression: (node: NodeT) => boolean
    isComment: (node: NodeT) => boolean
    canHaveChildren: (node: NodeT) => boolean
    getTextContent: (node: NodeT) => string
    getCommentData: (node: NodeT) => string
    commentDirectives: CommentDirectives
    inCompoundText: boolean
    visit: VisitForNested<NodeT>
    visitExpressionTag: (node: NodeT) => NestText[]
    checkHeuristic: (txt: string) => boolean
    wrapNested: WrapNestedFunc
    index: IndexTracker
}

export function separatelyVisitChildren<T>(props: VisitProps<T>): [boolean, boolean, boolean, NestText[]] {
    let hasTextChild = false
    let hasNonTextChild = false
    let heurTxt = ''
    let hasCommentDirectives = false
    for (const child of props.children) {
        if (props.isText(child)) {
            const text = props.getTextContent(child)
            const txt = text.trim()
            if (!txt) {
                continue
            }
            hasTextChild = true
            heurTxt += text + ' '
        } else if (props.isComment(child)) {
            if (props.getCommentData(child).trim().startsWith('@wc-')) {
                hasCommentDirectives = true
            }
        } else {
            hasNonTextChild = true
            heurTxt += `# `
        }
    }
    heurTxt = heurTxt.trimEnd()
    const passHeuristic = props.checkHeuristic(heurTxt)
    let hasCompoundText = hasTextChild && hasNonTextChild
    const visitAsOne = passHeuristic && !hasCommentDirectives
    if (props.inCompoundText || hasCompoundText && visitAsOne) {
        return [false, hasTextChild, hasCompoundText, []]
    }
    const txts = []
    // can't be extracted as one; visitSv each separately
    for (const child of props.children) {
        txts.push(...props.visit(child, props.inCompoundText))
    }
    return [true, false, false, txts]
}

export function visitMixedContent<T>(props: VisitProps<T>): NestText[] {
    if (props.children.length === 0) {
        return []
    }
    const [visitedSeparately, hasTextChild, hasCompoundText, separateTxts] = separatelyVisitChildren(props)
    if (visitedSeparately) {
        return separateTxts
    }
    let txt = ''
    let iArg = 0
    let iTag = 0
    const lastChildEnd = props.getRange(props.children.slice(-1)[0]).end
    const childrenNestedRanges: NestedRanges = []
    let hasTextDescendants = false
    const txts = []
    for (const child of props.children) {
        if (props.isComment(child)) {
            continue
        }
        const chRange = props.getRange(child)
        if (props.isText(child)) {
            const [startWh, trimmed, endWh] = nonWhitespaceText(props.getTextContent(child))
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
            props.mstr.remove(chRange.start, chRange.end)
            continue
        }
        if (props.isExpression(child)) {
            txts.push(...props.visitExpressionTag(child))
            if (!hasCompoundText) {
                continue
            }
            txt += `{${iArg}}`
            let moveStart = chRange.start
            if (iArg > 0) {
                props.mstr.update(chRange.start, chRange.start + 1, ', ')
            } else {
                moveStart++
                props.mstr.remove(chRange.start, chRange.start + 1)
            }
            props.mstr.move(moveStart, chRange.end - 1, lastChildEnd)
            props.mstr.remove(chRange.end - 1, chRange.end)
            iArg++
            continue
        }
        // elements, components and other things as well
        const canHaveChildren = props.canHaveChildren(child)
        const childTxts = props.visit(child, canHaveChildren)
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
        props.wrapNested(nTxt, iArg > 0, childrenNestedRanges, lastChildEnd)
    } else if (hasTextChild) {
        // no need for component use
        let begin = '{'
        let end = ')}'
        if (props.inCompoundText) {
            begin += `${varNames.rtTransCtx}(${varNames.nestCtx}`
        } else {
            begin += `${varNames.rtTrans}(${props.index.get(nTxt.toKey())}`
        }
        if (iArg > 0) {
            begin += ', ['
            end = ']' + end
        }
        props.mstr.appendLeft(lastChildEnd, begin)
        props.mstr.appendRight(lastChildEnd, end)
    }
    return txts
}
