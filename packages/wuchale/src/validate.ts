import type { CompiledElement, CompiledPlural, CompiledSingle, Composite } from './compile.js'

function isEquivalentSingle(source: CompiledSingle, translation: CompiledSingle) {
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
        if (transl == null || !isEquivalentSingle(elm.slice(1), transl.slice(1))) {
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

export function pluralForms(locale: string) {
    const supported = Intl.PluralRules.supportedLocalesOf([locale])
    if (supported.length === 0) {
        return []
    }
    return new Intl.PluralRules(locale).resolvedOptions().pluralCategories
}

function isEquivalentPlural(source: CompiledPlural, translation: CompiledPlural) {
    // extract all unique placeholders across all candidates
    const placeholders = new Map<number, boolean>()
    for (const singl of source) {
        if (typeof singl !== 'string') {
            for (const part of singl) {
                if (typeof part === 'number') {
                    placeholders.set(part, true)
                }
            }
        }
    }
    // if any of the candidates has an unknown placeholder, out
    for (const singl of translation) {
        if (typeof singl === 'string') {
            continue
        }
        for (const part of singl) {
            if (typeof part === 'number') {
                if (placeholders.has(part)) {
                    placeholders.set(part, false)
                } else {
                    return false
                }
            }
        }
    }
    // if any of the placeholders are not used at all, out
    for (const val of placeholders.values()) {
        if (val) {
            return false
        }
    }
    return true
}

export function isEquivalent(source: CompiledElement[], translation: CompiledElement[], forms: number) {
    if (source.length === 1) {
        if (translation.length !== 1) {
            return false
        }
        return isEquivalentSingle(source[0] as CompiledSingle, translation[0] as CompiledSingle)
    }
    // plural
    if (forms > 0 && translation.length !== forms) {
        return false
    }
    return isEquivalentPlural(source as CompiledPlural, translation as CompiledPlural)
}
