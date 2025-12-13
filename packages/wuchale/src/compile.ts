// for template literals and simple mixed markup
// for nested markup. first number indicates the tag index, rest are arguments
export type CompositePayload = number | string | Composite
export type Composite = [number, ...CompositePayload[]]
export type Mixed = (string | number)[]
export type CompiledElement = string | Mixed | CompositePayload[]

type SpecialType = 'open' | 'close' | 'selfclose' | 'placeholder'

const digitRange = ['0', '9'].map(d => d.charCodeAt(0))

function extractSpecial(msgStr: string, start: number): [SpecialType | null, number | null, number] {
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
        return ['placeholder', n, i + 1]
    }
    if (endChar === '/' && msgStr[i + 1] === '>') {
        return ['selfclose', n, i + 2]
    }
    if (endChar != '>') {
        return [null, null, start]
    }
    if (inClose) {
        return ['close', n, i + 1]
    }
    return ['open', n, i + 1]
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
        if (type === 'open') {
            currentOpenTag = n
            const [subExt, newIc] = compile(msgStr, newI, n)
            compiled.push([n as number, ...subExt])
            i = newIc
            continue
        }
        if (type === 'close') {
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
        } else if (type === 'selfclose') {
            compiled.push([n as number])
        } else { // placeholder
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
        return compiled as Composite
    } catch (err) {
        console.error(err)
        console.error(msgStr)
        return fallback
    }
}
