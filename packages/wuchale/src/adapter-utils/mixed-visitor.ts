// Shared logic between adapters for handling nested / mixed elements within elements / fragments

import type MagicString from 'magic-string'
import { getKey, type IndexTracker } from '../adapters.js'
import { type HeuristicResult, newText, type Scope, type Text } from '../text.js'
import {
    type CommentDirectives,
    commentPrefix,
    type RuntimeVars,
    restoreCommentDirectives,
    updateCommentDirectives,
    varNames,
} from './index.js'

type Range = { start: number; end: number }
type Scouted = { text: number; expr: number; element: number; comment: number; start: number; end: number }

export type WrapStrs = {
    begin: string // <W_tx x={ctx} a={[
    children: string[] // ]}><snip>, </snip><snip>
    end: string // </snip></W_tx>
}

type InitProps<MixNodeT, TxtT extends MixNodeT, ComT extends MixNodeT, ExprT extends MixNodeT> = {
    mstr: MagicString
    index: IndexTracker
    content: string
    scopePath: Scope[]
    exprBorder: [string, string]
    vars: () => RuntimeVars
    getRange: (node: MixNodeT) => Range
    isText: (node: MixNodeT) => node is TxtT
    isExpression: (node: MixNodeT) => node is ExprT
    isComment: (node: MixNodeT) => node is ComT
    leaveInPlace: (node: MixNodeT) => boolean
    getTextContent: (node: TxtT) => string
    getCommentData: (node: ComT) => string
    visitFunc: (node: MixNodeT) => Text[]
    checkHeuristic: (txt: Text) => HeuristicResult
    wrapNested: (index: number | null, hasExpr: boolean, needsCtx: boolean[]) => WrapStrs
}

export type ModFunc = (nested: boolean, lvlHasMsg: boolean) => void

type LevelMod = {
    txt: Text | null
    txts: [Text, () => void][]
    unit: boolean
    pending: boolean
    building: boolean
    funcs: ModFunc[]
    children: LevelMod[]
}

const newMod = (building = false, unit = false): LevelMod => ({
    txt: null,
    txts: [],
    building,
    unit,
    pending: true,
    funcs: [],
    children: [],
})

type TrimOut = [number, string, number]

/** trims from end first */
function trimText(body: string): TrimOut {
    const trimmedE = body.trimEnd()
    const endWh = body.length - trimmedE.length
    const trimmed = trimmedE.trimStart()
    const startWh = trimmedE.length - trimmed.length
    return [startWh, trimmed, endWh]
}

type VisitProps<NodeT> = {
    children: NodeT[]
    nestable: boolean
    commentDirectives: CommentDirectives
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
    #mod = new Map<Scope['type'], LevelMod>()

    constructor(props: InitProps<MixNodeT, TxtT, ComT, ExprT>) {
        this.#props = props
    }

    /** returns false when in dev mode and new txts are not allowed */
    #checkAllowNewMsg(txt: Text) {
        return this.#props.index.has(getKey(txt.body, txt.context))
    }

    #applyMod(mod: LevelMod, depth = 0) {
        if (!mod.pending) {
            return []
        }
        const txts: Text[] = []
        const nested = depth > 0
        let modify = nested
        if (!nested) {
            if (mod.txt) {
                if (mod.unit) {
                    mod.txt.type = 'message'
                    modify = true
                } else if (mod.building) {
                    if (this.#checkAllowNewMsg(mod.txt)) {
                        modify = true
                    }
                }
                modify && txts.push(mod.txt)
            }
            if (!modify) {
                for (const [txt, func] of mod.txts) {
                    if (!this.#checkAllowNewMsg(txt)) {
                        continue
                    }
                    txts.push(txt)
                    func()
                }
            }
        }
        if (modify) {
            for (const func of mod.funcs) {
                func(nested, mod.txt != null)
            }
        }
        for (const childMod of mod.children) {
            txts.push(...this.#applyMod(childMod, depth + (modify ? 1 : 0)))
        }
        mod.pending = false
        return txts
    }

    #applyModClear(scope: Scope['type'] = 'element') {
        const mod = this.#mod.get(scope)!
        const txts = this.#applyMod(mod)
        this.#mod.set(scope, newMod())
        return txts
    }

    #scout(children: MixNodeT[]): Scouted {
        const scouted: Scouted = { text: 0, expr: 0, element: 0, comment: 0, start: -1, end: -1 }
        let inContent = false
        for (const child of children) {
            const { start, end } = this.#props.getRange(child)
            if (this.#props.leaveInPlace(child)) {
                if (!inContent) {
                    scouted.start = end
                    scouted.end = end
                }
                continue
            }
            if (this.#props.isText(child)) {
                const [startWh, trimmed, endWh] = trimText(this.#props.getTextContent(child))
                if (trimmed) {
                    if (!inContent) {
                        scouted.start = start + startWh
                        inContent = true
                    }
                    scouted.end = end - endWh
                    scouted.text++
                } else {
                    scouted.end = start
                }
                continue
            }
            if (!inContent) {
                scouted.start = start
                inContent = true
            }
            scouted.end = end
            if (this.#props.isExpression(child)) {
                scouted.expr++
            } else if (this.#props.isComment(child)) {
                scouted.comment++
            } else {
                scouted.element++
            }
        }
        return scouted
    }

    #makeTxt(props: VisitProps<MixNodeT>, body: string, placeholders: [string, string][] = []): [Text, boolean] {
        const txt = newText({
            body: body.trim(),
            path: this.#props.scopePath,
            context: props.commentDirectives.context,
            placeholders,
        })
        const heurMsgType = this.#props.checkHeuristic(txt)
        if (heurMsgType) {
            txt.type = heurMsgType
        }
        return [txt, heurMsgType !== false]
    }

    #text(
        mod: LevelMod,
        props: VisitProps<MixNodeT>,
        trimOut: TrimOut,
        range: Range,
        scouted: Scouted,
        ignore: boolean,
    ): string {
        let [startWh, trimmed, endWh] = trimOut
        let { start, end } = range
        if (!ignore) {
            const [txt, passedHeur] = this.#makeTxt(props, trimmed)
            if (passedHeur) {
                mod.txts.push([
                    txt,
                    () => {
                        const index = this.#props.index.get(getKey(txt.body, txt.context))
                        const [left, right] = this.#props.exprBorder
                        this.#props.mstr.update(
                            start + startWh,
                            end - endWh,
                            `${left}${this.#props.vars().rtTrans}(${index})${right}`,
                        )
                    },
                ])
            }
        }
        mod.funcs.push((nested, lvlHasMsg) => {
            if (!lvlHasMsg) {
                // no sibling at this level passes heuristic
                return
            }
            if (!nested && scouted.text === 1 && scouted.element === 0 && scouted.expr === 0) {
                start += startWh
                end -= endWh
            }
            this.#props.mstr.remove(start, end)
        })
        if (endWh) {
            trimmed += ' '
        }
        if (startWh || trimmed === '') {
            trimmed = ' ' + trimmed
        }
        return trimmed
    }

    #expression(funcs: ModFunc[], range: Range, iArg: number, placeholders: [string, string][], argsIndex: number) {
        const [left, right] = this.#props.exprBorder
        const start = range.start + left.length
        const end = range.end - right.length
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
            if (argsIndex !== moveStart) {
                this.#props.mstr.move(moveStart, end, argsIndex)
            }
            this.#props.mstr.remove(end, range.end)
        })
        return `{${iArg}}`
    }

    #finalMod(
        props: VisitProps<MixNodeT>,
        txt: Text,
        childrenStarts: number[],
        childrenCtx: boolean[],
        hasExpr: boolean,
        scouted: Scouted,
    ): ModFunc {
        const vars = this.#props.vars()
        const scope = this.#props.scopePath.at(-1)!
        return nested => {
            const index = this.#props.index.get(getKey(txt.body, txt.context))
            if (((props.useComponent ?? true) && scope.type === 'element' && hasExpr) || childrenStarts.length > 0) {
                if (scouted.element + scouted.text + scouted.expr > 1) {
                    const strs = this.#props.wrapNested(nested ? null : index, hasExpr, childrenCtx)
                    this.#props.mstr.appendLeft(scouted.start, strs.begin)
                    for (const [i, childStart] of childrenStarts.entries()) {
                        this.#props.mstr.appendRight(childStart, strs.children[i]!)
                    }
                    this.#props.mstr.appendRight(scouted.end, strs.end)
                }
                return
            }
            // no need for component use
            const [left, right] = this.#props.exprBorder
            let begin = left
            let end = `)${right}`
            if (nested) {
                begin += `${vars.rtTransCtx}(${vars.nestCtx}`
            } else {
                if (txt.type === 'url') {
                    begin += `${varNames.urlLocalize}(`
                    end = `), ${vars.rtLocale}${end}`
                }
                begin += `${vars.rtTrans}(${index}`
            }
            if (hasExpr) {
                begin += ', ['
                end = `]${end}`
            }
            if (scope.type === 'attribute' && `'"`.includes(this.#props.content[scouted.end]!)) {
                this.#props.mstr.remove(scouted.start - 1, scouted.start)
                this.#props.mstr.remove(scouted.end, scouted.end + 1)
            }
            this.#props.mstr.appendLeft(scouted.start, begin)
            this.#props.mstr.appendRight(scouted.end, end)
        }
    }

    #getMod(scope: Scope, nestable: boolean, building: boolean, addFunc?: ModFunc) {
        let mod = this.#mod.get(scope.type)
        if (!mod) {
            mod = newMod()
            this.#mod.set(scope.type, mod)
        }
        if (addFunc) {
            mod.funcs.push(addFunc)
        }
        mod.building = (nestable && mod.building) || building
        return mod
    }

    visit(props: VisitProps<MixNodeT>) {
        if (props.children.length === 0) {
            return []
        }
        let hasCommentDirectives = false
        let body = ''
        let iArg = 0
        let iTag = 0
        const commentDirectivesOrig: CommentDirectives = { ...props.commentDirectives }
        let lastVisitIsComment = false
        const scouted = this.#scout(props.children)
        const childrenStarts: number[] = []
        const childrenCtx: boolean[] = []
        const txts: Text[] = []
        const placeholders: [string, string][] = []
        const alreadyInsideUnit = props.commentDirectives.unit ?? false
        const scope = this.#props.scopePath.at(-1)!
        const mod = this.#getMod(scope, props.nestable, alreadyInsideUnit || scouted.text > 0, props.addMod)
        const exprFuncs: ModFunc[] = []
        for (const child of props.children) {
            const chRange = this.#props.getRange(child)
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
            if (this.#props.isText(child)) {
                if (chRange.end <= scouted.start) {
                    continue
                }
                const trimOut = trimText(this.#props.getTextContent(child))
                const add = this.#text(
                    mod,
                    props,
                    trimOut,
                    chRange,
                    scouted,
                    props.commentDirectives.forceType === false,
                )
                if (add === ' ') {
                    if (!body.endsWith(add)) {
                        body += add
                    }
                    continue
                }
                body += add
            } else if (props.commentDirectives.forceType !== false) {
                if (this.#props.leaveInPlace(child)) {
                    txts.push(...this.#props.visitFunc(child))
                    if (chRange.end > scouted.start) {
                        mod.funcs.push(() => this.#props.mstr.move(chRange.start, chRange.end, scouted.start))
                    }
                } else if (this.#props.isExpression(child)) {
                    txts.push(...this.#props.visitFunc(child))
                    if (scouted.text > 0 || scouted.element > 0) {
                        body += this.#expression(exprFuncs, chRange, iArg, placeholders, scouted.start)
                        iArg++
                    }
                } else {
                    // elements, components and other things as well
                    const childMod = newMod(mod.building, !alreadyInsideUnit && props.commentDirectives.unit)
                    this.#mod.set(scope.type, childMod)
                    txts.push(...this.#props.visitFunc(child))
                    this.#mod.set(scope.type, mod)
                    mod.children.push(childMod)
                    let nestedNeedsCtx = false
                    let chTxt = `<${iTag}/>`
                    if (childMod.pending && childMod.txt) {
                        if (scouted.element === 1 && scouted.expr === 0 && scouted.text === 0) {
                            chTxt = childMod.txt.body as string
                            placeholders.push(...childMod.txt.placeholders)
                        } else {
                            chTxt = `<${iTag}>${childMod.txt.body as string}</${iTag}>`
                            for (const [num, cont] of childMod.txt.placeholders) {
                                placeholders.push([`${iTag}.${num}`, cont])
                            }
                            nestedNeedsCtx = true
                        }
                    }
                    childrenStarts.push(chRange.start)
                    childrenCtx.push(nestedNeedsCtx)
                    body += chTxt
                    iTag++
                }
            }
            if (!lastVisitIsComment) {
                continue
            }
            restoreCommentDirectives(props.commentDirectives, commentDirectivesOrig)
            lastVisitIsComment = false
        }
        const [txt, passedHeur] = this.#makeTxt(props, body, placeholders)
        if ((passedHeur || mod.unit) && !hasCommentDirectives) {
            mod.txt = txt // can be taken together, and lvlHasMsg
            mod.funcs.push(...exprFuncs, this.#finalMod(props, txt, childrenStarts, childrenCtx, iArg > 0, scouted))
        }
        if (mod.unit || !mod.building || hasCommentDirectives || !props.nestable) {
            txts.push(...this.#applyModClear(scope.type))
        }
        return txts
    }
}
