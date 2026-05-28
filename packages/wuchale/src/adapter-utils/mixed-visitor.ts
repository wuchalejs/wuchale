// Shared logic between adapters for handling nested / mixed elements within elements / fragments

import MagicString from 'magic-string'
import {
    getKey,
    type HeuristicDetails,
    type HeuristicDetailsBase,
    type HeuristicFunc,
    IndexTracker,
    type Message,
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

const noopIndex = new IndexTracker()

const noopMstr = new Proxy(new MagicString(''), {
    get: (target, p: keyof MagicString) => {
        if (typeof target[p] === 'function') {
            return () => {}
        }
        return target[p]
    },
})

type NestedRanges = [number, number, boolean][]

type VisitVolatileCtx<A> = {
    mstr: MagicString
    index: IndexTracker
    inCompoundText: boolean
    addCtx: A
}

type VisitNestedCtx<A> = Omit<VisitVolatileCtx<A>, 'inCompoundText'>

type VisitFunc<MixNodeT, AddCtx> = (node: MixNodeT, ctx: VisitVolatileCtx<AddCtx>) => Message[]

type InitProps<
    MixNodeT,
    AddCtx extends object,
    TxtT extends MixNodeT,
    ComT extends MixNodeT,
    ExprT extends MixNodeT,
> = {
    vars: () => RuntimeVars
    content: string
    getRange: (node: MixNodeT) => { start: number; end: number }
    isText: (node: MixNodeT) => node is TxtT
    isExpression: (node: MixNodeT) => node is ExprT
    isComment: (node: MixNodeT) => node is ComT
    leaveInPlace: (node: MixNodeT) => boolean
    canHaveChildren: (node: MixNodeT) => boolean
    getTextContent: (node: TxtT) => string
    getCommentData: (node: ComT) => string
    visitFunc: VisitFunc<MixNodeT, AddCtx>
    fullHeuristicDetails: (details: HeuristicDetailsBase) => HeuristicDetails
    checkHeuristic: HeuristicFunc
    wrapNested: (msgInfo: Message, hasExprs: boolean, nestedRanges: NestedRanges, lastChildEnd: number) => void
}

export type MixedScope = 'markup' | 'attribute'

type VisitProps<NodeT, AddCtx> = VisitVolatileCtx<AddCtx> & {
    children: NodeT[]
    commentDirectives: CommentDirectives
    scope: MixedScope
    element: string
    attribute?: string
    /** force using component instead of a function call.
     * set to true when variables can be objects that cannot be converted to strings like
     * e.g. components in jsx to prevent `[object Object]` being rendered. */
    useComponent?: boolean
}

export class MixedVisitor<
    MixNodeT,
    AddCtx extends object,
    TxtT extends MixNodeT,
    ComT extends MixNodeT,
    ExprT extends MixNodeT,
> {
    #props: InitProps<MixNodeT, AddCtx, TxtT, ComT, ExprT>

    constructor(props: InitProps<MixNodeT, AddCtx, TxtT, ComT, ExprT>) {
        this.#props = props
    }

    separatelyVisitChildren = (props: VisitProps<MixNodeT, AddCtx>) => {
        const msgs: Message[] = []
        if (props.scope !== 'markup') {
            return msgs
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
                msgs.push(
                    ...this.#props.visitFunc(child, {
                        mstr: props.mstr,
                        index: props.index,
                        addCtx: props.addCtx,
                        inCompoundText: false,
                    }),
                )
            }
            if (!lastVisitIsComment) {
                continue
            }
            restoreCommentDirectives(props.commentDirectives, commentDirectivesOrig)
            lastVisitIsComment = false
        }
        return msgs
    }

    visitNested(props: VisitProps<MixNodeT, AddCtx>, ctx: VisitNestedCtx<AddCtx>, asCompound: true): Message[]
    visitNested(props: VisitProps<MixNodeT, AddCtx>, ctx: VisitNestedCtx<AddCtx>, asCompound: false): boolean
    visitNested(props: VisitProps<MixNodeT, AddCtx>, ctx: VisitNestedCtx<AddCtx>, asCompound: boolean) {
        let hasTextChild = false
        let hasNonTextChild = false
        let hasCommentDirectives = false
        let hasTextDescendants = false
        let msgStr = ''
        let iArg = 0
        let iTag = 0
        const lastChildEnd = this.#props.getRange(props.children.slice(-1)[0]!).end
        const childrenNestedRanges: NestedRanges = []
        const msgs: Message[] = []
        const placeholders: [string, string][] = []
        for (const child of props.children) {
            if (this.#props.isComment(child)) {
                if (this.#props.getCommentData(child).trim().startsWith(commentPrefix)) {
                    hasCommentDirectives = true
                }
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
                hasTextChild = true
                msgStr += msgInfo.msgStr
                if (endWh) {
                    msgStr += ' '
                }
                ctx.mstr.remove(chRange.start, chRange.end)
                continue
            }
            if (this.#props.leaveInPlace(child)) {
                msgs.push(
                    ...this.#props.visitFunc(child, { ...ctx, inCompoundText: this.#props.canHaveChildren(child) }),
                )
                continue
            }
            hasNonTextChild = true
            if (this.#props.isExpression(child)) {
                msgs.push(...this.#props.visitFunc(child, { ...ctx, inCompoundText: props.inCompoundText }))
                msgStr += `{${iArg}}`
                placeholders.push([iArg.toString(), this.#props.content.slice(chRange.start + 1, chRange.end - 1)])
                let moveStart = chRange.start
                if (iArg > 0) {
                    ctx.mstr.update(chRange.start, chRange.start + 1, ', ')
                } else {
                    moveStart++
                    ctx.mstr.remove(chRange.start, chRange.start + 1)
                }
                ctx.mstr.move(moveStart, chRange.end - 1, lastChildEnd)
                ctx.mstr.remove(chRange.end - 1, chRange.end)
                iArg++
                continue
            }
            // elements, components and other things as well
            const canHaveChildren = this.#props.canHaveChildren(child)
            const childMsgs = this.#props.visitFunc(child, { ...ctx, inCompoundText: asCompound })
            let nestedNeedsCtx = false
            let chTxt = ''
            for (const msgInfo of childMsgs) {
                if (canHaveChildren && msgInfo.details.scope === props.scope) {
                    chTxt += msgInfo.msgStr[0]
                    for (const [num, cont] of msgInfo.placeholders) {
                        placeholders.push([`${iTag}.${num}`, cont])
                    }
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
        const heurMsgType = this.#props.checkHeuristic(msgInfo)
        msgInfo.type = heurMsgType || 'message'
        const canBeCompound =
            props.inCompoundText ||
            props.commentDirectives.unit ||
            (hasTextChild && hasNonTextChild && !hasCommentDirectives)
        const allChecksPassed = props.commentDirectives.unit || (canBeCompound && heurMsgType)
        if (!asCompound) {
            return allChecksPassed
        }
        if (!allChecksPassed) {
            return msgs
        }
        if (hasTextChild || hasTextDescendants) {
            msgs.push(msgInfo)
        } else {
            return msgs
        }
        if (((props.useComponent ?? true) && props.scope === 'markup' && iArg > 0) || childrenNestedRanges.length > 0) {
            this.#props.wrapNested(msgInfo, iArg > 0, childrenNestedRanges, lastChildEnd)
            return msgs
        }
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
            begin += `${this.#props.vars().rtTrans}(${props.index.get(getKey(msgInfo.msgStr, msgInfo.context))}`
        }
        if (iArg > 0) {
            begin += ', ['
            end = `]${end}`
        }
        if (props.scope === 'attribute' && `'"`.includes(this.#props.content[lastChildEnd]!)) {
            const firstChild = props.children[0]!
            const { start } = this.#props.getRange(firstChild)
            ctx.mstr.remove(start - 1, start)
            ctx.mstr.remove(lastChildEnd, lastChildEnd + 1)
        }
        ctx.mstr.appendLeft(lastChildEnd, begin)
        ctx.mstr.appendRight(lastChildEnd, end)
        return msgs
    }

    visit = (props: VisitProps<MixNodeT, AddCtx>): Message[] => {
        if (props.children.length === 0) {
            return []
        }
        if (!this.visitNested(props, { mstr: noopMstr, index: noopIndex, addCtx: { ...props.addCtx } }, false)) {
            return this.separatelyVisitChildren(props)
        }
        return this.visitNested(props, { mstr: props.mstr, index: props.index, addCtx: props.addCtx }, true) // really modify
    }

    static withCtxRestore<MixNodeT, AddCtx>(
        transformer: VisitVolatileCtx<AddCtx>,
        visitChild: (child: MixNodeT) => Message[],
    ): VisitFunc<MixNodeT, AddCtx> {
        return (child, ctx) => {
            const prevCtx: VisitVolatileCtx<AddCtx> = {
                inCompoundText: transformer.inCompoundText,
                mstr: transformer.mstr,
                index: transformer.index,
                addCtx: transformer.addCtx,
            }
            Object.assign(transformer, ctx)
            const msgs = visitChild(child)
            // restore
            Object.assign(transformer, prevCtx)
            return msgs
        }
    }
}
