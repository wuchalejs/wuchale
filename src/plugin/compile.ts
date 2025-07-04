// $$ cd .. && npm run test

type CompiledNestedFragment = (string | number | CompiledNestedFragment)[]
export type CompiledFragment = string | number | CompiledNestedFragment
type SpecialType = 'open' | 'close' | 'selfclose' | 'placeholder'

const digitRange = ['0', '9'].map(d => d.charCodeAt(0))

function extractSpecial(txt: string, start: number): [SpecialType, number, number] {
    const inPlaceHolder = txt[start] === '{'
    const inTag = txt[start] === '<'
    if (!inTag && !inPlaceHolder) {
        return [null, null, start]
    }
    let digits = ''
    let endChar = ''
    let inClose = false
    let i = start + 1
    const beginChar = txt[i]
    if (beginChar === '/') {
        inClose = true
        i++
    }
    while (i < txt.length) {
        const char = txt[i]
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
    if (endChar === '/' && txt[i + 1] === '>') {
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

function compile(txt: string, start = 0, parentTag = null): [CompiledNestedFragment, number] {
    let curTxt = ''
    const ext: CompiledNestedFragment = []
    let i = start
    const len = txt.length
    let currentOpenTag = null
    while (i < len) {
        const char = txt[i]
        const [type, n, newI] = extractSpecial(txt, i)
        if (type === null) {
            curTxt += char
            i++
            continue
        }
        if (curTxt) {
            ext.push(curTxt)
            curTxt = ''
        }
        if (type === 'open') {
            currentOpenTag = n
            const [subExt, newIc] = compile(txt, newI, n)
            ext.push([n, ...subExt])
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
            ext.push([n])
        } else { // placeholder
            ext.push(n)
        }
        i = newI
    }
    if (curTxt) {
        ext.push(curTxt)
    }
    return [ext, i]
}

export default function compileTranslation(text: string, fallback: CompiledFragment): CompiledFragment {
    if (!text) {
        return fallback
    }
    try {
        const [compiled] = compile(text)
        if (compiled.length === 1 && typeof compiled[0] === 'string') {
            return compiled[0]
        }
        return compiled
    } catch (err) {
        console.error(err)
        console.error(text)
        return fallback
    }
}
