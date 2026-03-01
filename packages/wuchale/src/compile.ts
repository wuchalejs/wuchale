export type CompositePayload = number | string | Composite
// for nested markup. first number indicates the tag index, rest are arguments
export type Composite = [number, ...CompositePayload[]]
export type Mixed = (string | number)[] // in e.g. attributes and template literals
export type CompiledElement = string | Mixed | CompositePayload[] // in e.g. nested svelte elements

const OPEN = Symbol()
const CLOSE = Symbol()
const SELF_CLOSE = Symbol()
const PLACEHOLDER = Symbol()

const digitRange = ['0', '9'].map(d => d.charCodeAt(0))

function extractSpecial(msgStr: string, start: number): [symbol | null, number | null, number] {
    const inPlaceHolder = msgStr[start] === '{'
    const inTag = msgStr[start] === '<'
    if (!inTag && !inPlaceHolder) {
        return [null, null, start]
    }
    let digits = ''
    let endChar = ''
    let inClose = false
    let i = start + 1
    const beginChar = msgStr[i]
    if (inTag && beginChar === '/') {
        inClose = true
        i++
    }
    while (i < msgStr.length) {
        const char = msgStr[i]
        const code = char.charCodeAt(0)
        if (code < digitRange[0] || code > digitRange[1]) {
            endChar = char
            break
        }
        digits += char
        i++
    }
    if (!digits) {
        return [null, null, start]
    }
    const n = Number(digits)
    if (inPlaceHolder) {
        if (endChar !== '}') {
            return [null, null, start]
        }
        return [PLACEHOLDER, n, i + 1]
    }
    if (endChar === '/' && msgStr[i + 1] === '>') {
        return [SELF_CLOSE, n, i + 2]
    }
    if (endChar != '>') {
        return [null, null, start]
    }
    if (inClose) {
        return [CLOSE, n, i + 1]
    }
    return [OPEN, n, i + 1]
}

function compile(msgStr: string, start = 0, parentTag: number | null = null): [CompositePayload[], number] {
    let curTxt = ''
    const compiled: CompositePayload[] = []
    let i = start
    const len = msgStr.length
    let currentOpenTag: number | null = null
    while (i < len) {
        const char = msgStr[i]
        const [type, n, newI] = extractSpecial(msgStr, i)
        if (type === null) {
            curTxt += char
            i++
            continue
        }
        if (curTxt) {
            compiled.push(curTxt)
            curTxt = ''
        }
        if (type === OPEN) {
            currentOpenTag = n
            const [subExt, newIc] = compile(msgStr, newI, n)
            compiled.push([n as number, ...subExt])
            i = newIc
            continue
        }
        if (type === CLOSE) {
            if (currentOpenTag != null) {
                if (currentOpenTag != n) {
                    throw Error('Closing a different tag')
                }
                currentOpenTag = null
            } else if (n === parentTag) {
                break
            } else {
                throw Error('Closing a different tag')
            }
        } else if (type === SELF_CLOSE) {
            compiled.push([n as number])
        } else {
            // placeholder
            compiled.push(n as number)
        }
        i = newI
    }
    if (curTxt) {
        compiled.push(curTxt)
    }
    return [compiled, i]
}

export function compileTranslation(msgStr: string, fallback: CompiledElement): CompiledElement {
    if (!msgStr) {
        return fallback
    }
    try {
        const [compiled] = compile(msgStr)
        if (compiled.length === 1 && typeof compiled[0] === 'string') {
            return compiled[0]
        }
        return compiled
    } catch (err) {
        console.error(err)
        console.error(msgStr)
        return fallback
    }
}

export function isEquivalent(source: CompiledElement, translation: CompiledElement) {
    const sourceStr = typeof source === 'string'
    const translStr = typeof translation === 'string'
    if (sourceStr || translStr) {
        return sourceStr === translStr
    }
    let stringsS = 0
    for (const elm of source) {
        if (typeof elm === 'string') {
            stringsS++
            continue
        }
        if (typeof elm === 'number') {
            if (!translation.includes(elm)) {
                return false
            }
            continue
        }
        const transl = translation.find(t => Array.isArray(t) && t[0] === elm[0]) as Composite | null
        if (transl == null || !isEquivalent(elm.slice(1), transl.slice(1))) {
            return false
        }
    }
    let stringsT = 0
    for (const transl of translation) {
        if (typeof transl === 'string') {
            stringsT++
        }
    }
    return (stringsS === 0) === (stringsT === 0) && source.length - stringsS === translation.length - stringsT
}
