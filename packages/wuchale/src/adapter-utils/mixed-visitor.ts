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

type NestedRanges = [number, number, boolean][]
type Range = { start: number; end: number }
type Nums = { text: number; expr: number; element: number; comment: number }

type InitProps<MixNodeT, TxtT extends MixNodeT, ComT extends MixNodeT, ExprT extends MixNodeT> = {
    mstr: MagicString
    index: IndexTracker
    content: string
    scopePath: Scope[]
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
    wrapNested: (index: number | null, hasExpr: boolean, nestedRanges: NestedRanges, lastChildEnd: number) => void
}

export type ModFunc = (nested: boolean, lvlHasMsg: boolean) => void

type LevelMod = {
    txt: Text | null
    txts: [Text, () => void][]
    hasTxtDesc: boolean
    unit: boolean
    pending: boolean
    building: boolean
    funcs: ModFunc[]
    children: LevelMod[]
}

const newMod = (building = false, unit = false): LevelMod => ({
    txt: null,
    hasTxtDesc: false,
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
                    const heurMsgType = this.#props.checkHeuristic(mod.txt)
                    if (heurMsgType && this.#checkAllowNewMsg(mod.txt)) {
                        mod.txt.type = heurMsgType
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

    #getLastChildEnd(children: MixNodeT[]): number {
        const lastChild = children.slice(-1)[0]!
        const lastChildEnd = this.#props.getRange(lastChild).end
        if (this.#props.isText(lastChild)) {
            const [, , endWh] = trimText(this.#props.getTextContent(lastChild))
            return lastChildEnd - endWh
        }
        return lastChildEnd
    }

    #makeTxt(props: VisitProps<MixNodeT>, body: string, placeholders: [string, string][] = []) {
        return newText({
            body: body.trim(),
            path: this.#props.scopePath,
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

    #text(mod: LevelMod, props: VisitProps<MixNodeT>, trimOut: TrimOut, range: Range, nums: Nums): string {
        let [startWh, trimmed, endWh] = trimOut
        let { start, end } = range
        const txt = this.#makeTxt(props, trimmed)
        const heurMsgType = this.#props.checkHeuristic(txt)
        if (heurMsgType) {
            txt.type = heurMsgType
            mod.hasTxtDesc = true
            mod.txts.push([
                txt,
                () => {
                    const index = this.#props.index.get(getKey(txt.body, txt.context))
                    this.#props.mstr.update(start + startWh, end - endWh, `{${this.#props.vars().rtTrans}(${index})}`)
                },
            ])
        }
        mod.funcs.push((nested, lvlHasMsg) => {
            if (!lvlHasMsg) {
                // no sibling at this level passes heuristic
                return
            }
            if (!nested && nums.text === 1 && nums.element === 0 && nums.expr === 0) {
                start += startWh
                end -= endWh
            }
            this.#props.mstr.remove(start, end)
        })
        if (endWh) {
            trimmed += ' '
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
        txt: Text,
        lastChildEnd: number,
        childrenNestedRanges: [number, number, boolean][],
        hasExpr: boolean,
        nums: Nums,
    ): ModFunc {
        const vars = this.#props.vars()
        const scope = this.#props.scopePath.at(-1)!
        return nested => {
            const index = this.#props.index.get(getKey(txt.body, txt.context))
            if (
                ((props.useComponent ?? true) && scope.type === 'element' && hasExpr) ||
                childrenNestedRanges.length > 0
            ) {
                if (nums.element + nums.text + nums.expr > 1) {
                    this.#props.wrapNested(nested ? null : index, hasExpr, childrenNestedRanges, lastChildEnd)
                }
                return
            }
            // no need for component use
            let begin = '{'
            let end = ')}'
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
            if (scope.type === 'attribute' && `'"`.includes(this.#props.content[lastChildEnd]!)) {
                const firstChild = props.children[0]!
                const { start } = this.#props.getRange(firstChild)
                this.#props.mstr.remove(start - 1, start)
                this.#props.mstr.remove(lastChildEnd, lastChildEnd + 1)
            }
            this.#props.mstr.appendLeft(lastChildEnd, begin)
            this.#props.mstr.appendRight(lastChildEnd, end)
        }
    }

    #getMod(scope: Scope, building: boolean, addFunc?: ModFunc) {
        let mod = this.#mod.get(scope.type)
        if (!mod) {
            mod = newMod()
            this.#mod.set(scope.type, mod)
        }
        if (addFunc) {
            mod.funcs.push(addFunc)
        }
        mod.building ||= building
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
        const lastChildEnd = this.#getLastChildEnd(props.children)
        const childrenNestedRanges: NestedRanges = []
        const txts: Text[] = []
        const placeholders: [string, string][] = []
        const alreadyInsideUnit = props.commentDirectives.unit ?? false
        const scope = this.#props.scopePath.at(-1)!
        const nums = this.#childNums(props.children)
        const mod = this.#getMod(scope, alreadyInsideUnit || nums.text > 0, props.addMod)
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
                if ((startWh || trimmed === '') && !body.endsWith(' ')) {
                    body += ' '
                }
                if (!trimmed) {
                    // whitespace
                    continue
                }
                if (props.commentDirectives.forceType !== false) {
                    body += this.#text(mod, props, trimOut, chRange, nums)
                }
            } else if (props.commentDirectives.forceType !== false) {
                if (this.#props.leaveInPlace(child)) {
                    txts.push(...this.#props.visitFunc(child))
                } else if (this.#props.isExpression(child)) {
                    txts.push(...this.#props.visitFunc(child))
                    if (nums.text > 0 || nums.element > 0) {
                        body += this.#expression(exprFuncs, chRange, iArg, placeholders, lastChildEnd)
                        iArg++
                    }
                } else {
                    // elements, components and other things as well
                    const childMod = newMod(
                        props.nestable && mod.building,
                        !alreadyInsideUnit && props.commentDirectives.unit,
                    )
                    this.#mod.set(scope.type, childMod)
                    txts.push(...this.#props.visitFunc(child))
                    this.#mod.set(scope.type, mod)
                    mod.children.push(childMod)
                    let nestedNeedsCtx = false
                    let chTxt = `<${iTag}/>`
                    mod.hasTxtDesc ||= childMod.hasTxtDesc
                    if (childMod.pending && childMod.txt) {
                        if (nums.element === 1 && nums.expr === 0 && nums.text === 0) {
                            chTxt = childMod.txt.body as string
                            placeholders.push(...childMod.txt.placeholders)
                        } else if (childMod.hasTxtDesc) {
                            chTxt = `<${iTag}>${childMod.txt.body as string}</${iTag}>`
                            for (const [num, cont] of childMod.txt.placeholders) {
                                placeholders.push([`${iTag}.${num}`, cont])
                            }
                            nestedNeedsCtx = true
                        }
                    }
                    childrenNestedRanges.push([chRange.start, chRange.end, nestedNeedsCtx])
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
        const txt = this.#makeTxt(props, body, placeholders)
        if (mod.hasTxtDesc) {
            if (!hasCommentDirectives) {
                mod.txt = txt // can be taken together, and lvlHasMsg
            }
            mod.funcs.push(...exprFuncs, this.#finalMod(props, txt, lastChildEnd, childrenNestedRanges, iArg > 0, nums))
        }
        if (mod.unit || !mod.building || hasCommentDirectives || !props.nestable) {
            txts.push(...this.#applyModClear(scope.type))
        }
        return txts
    }
}
