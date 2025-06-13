// $$ node %f
const __dirname = 'bar'
const localesDir = '../../locales/'

import { parse } from "svelte/compiler";
import {writeFileSync, readFileSync} from 'node:fs'
import MagicString from "magic-string"
import compileTranslations from "./compile.js"

const translations = {}
const locales = ['en', 'am']
// const localesDir = './locales/'
const localeFile = loc => `${localesDir}${loc}.json`
for (const loc of locales) {
    try {
        const contents = readFileSync(localeFile(loc))
        translations[loc] = JSON.parse(contents.toString() || '{}')
    } catch (err) {
        if (err.code === 'ENOENT') {
            translations[loc] = {}
        }
    }
}

function walkExpression(node) {
    const txts = []
    if (node.type === 'Literal') {
        if (typeof node.value === 'string' && node.value.startsWith('+')) {
            txts.push(node)
        }
    } else if (node.type === 'ArrayExpression') {
        for (const elm of node.elements) {
            txts.push(...walkExpression(elm))
        }
    } else if (node.type === 'ObjectExpression') {
        for (const prop of node.properties) {
            txts.push(...walkExpression(prop.key))
            txts.push(...walkExpression(prop.value))
        }
    } else if (node.type === 'MemberExpression') {
        txts.push(...walkExpression(node.object))
        txts.push(...walkExpression(node.property))
    } else if (node.type === 'TemplateLiteral' && node.quasis[0]?.value?.cooked?.startsWith('+')) {
        for (const expr of node.expressions) {
            txts.push(...walkExpression(expr))
        }
        node.data = ''
        node.args = []
        let iArg = 0
        for (const quasi of node.quasis) {
            node.data += quasi.value.cooked
            if (quasi.tail) {
                break
            }
            const {start, end} = node.expressions[iArg]
            node.args.push([start, end])
            node.data += `{${iArg}}`
            iArg++
        }
        txts.push(node)
    } else {
        // console.log(node)
    }
    return txts
}

function walkScript(node) {
    const varInits = []
    for (const part of node) {
        if (part.type !== 'VariableDeclaration') {
            continue
        }
        for (const dec of part.declarations) {
            if (!dec.init) {
                continue
            }
            const txts = walkExpression(dec.init)
            if (txts.length) {
                varInits.push({start: dec.init.start, end: dec.init.end, txts})
            }
        }
    }
    return varInits
}

function walkHTML(node, amongText = false) {
    const txts = []
    for (const attrib of node.attributes ?? []) {
        // no idea why value is an array, take the first one to decide the type of enclosure ("" vs {})
        let value = attrib.values
        if (attrib.value && attrib.value !== true) {
            value = attrib.value[0]
        }
        if (value.type === 'Text' && value.data.trim().startsWith('+')) {
            txts.push(attrib)
        } else {
            txts.push(...walkHTML(value, amongText))
        }
    }
    if (node.children) {
        if (!amongText) {
            let nonText = false
            for (const child of node.children) {
                if (child.type === 'Text') {
                    if (child.data.trim()) {
                        amongText = true
                    }
                } else {
                    nonText = true
                }
            }
            amongText &&= nonText // mixed content
        }
        const newNode = {data: '', args: [], tags: [], start: node.children[0]?.start, end: null}
        let iArg = 0
        let iTag = 0
        for (const child of node.children) {
            newNode.end = child.end
            if (!amongText) {
                txts.push(...walkHTML(child, amongText))
                continue
            }
            let childExtract = ''
            if (child.type === 'MustacheTag') {
                txts.push(...walkExpression(child.expression))
                childExtract += `{${iArg}}`
                newNode.args.push([child.expression.start, child.expression.end])
                iArg++
            } else {
                for (const extract of walkHTML(child, amongText)) {
                    childExtract += extract.data
                }
                if (child.type !== 'Text') {
                    newNode.tags.push([child.start, child.end])
                }
            }
            if (childExtract && child.children) {
                childExtract = `<${iTag}>${childExtract}</${iTag}>`
                iTag++
            }
            newNode.data += childExtract
        }
        if (newNode.data) {
            if (newNode.tags.length) {
                newNode.type = 'CompoundText'
            } else {
                newNode.type = 'TemplateLiteral'
            }
            txts.push(newNode)
        }
    } else if (node.type === 'Text') {
        let text = node.data.replace(/\s+/g, ' ')
        let ttext = text.trim()
        if (!amongText) {
            text = ttext
        }
        if (ttext) {
            txts.push({...node, data: text})
        }
    } else if (node.type === 'MustacheTag') {
        txts.push(...walkExpression(node.expression))
    } else if (node.type === 'Comment') {
    } else {
        // console.log(ast)
    }
    return txts
}

const escapeQuote = txt => txt.replace("'", "\\'")
const getArgs = (content, node) => node.args.map(([start, end]) => content.slice(start, end))

function preprocess({ content, attributes, markup, filename }) {
    if (filename.startsWith(__dirname)) {
        return {}
    }
    const mstr = new MagicString(content)
    const ast = parse(content, {filename})
    let needImport = false
    let added = false
    function handleScriptNode(node) {
        let txt
        let repl
        if (node.type === 'TemplateLiteral') {
            txt = node.data
            const args = getArgs(content, node)
            repl = `t('${escapeQuote(txt)}', ${args.join(',')})`
        } else if (node.type === 'Literal') {
            txt = node.value
            repl = `t('${escapeQuote(txt)}')`
        } else {
            console.error('Unexpected script node', node)
        }
        if (!txt) {
            return
        }
        needImport = true
        mstr.update(node.start, node.end, repl)
        for (const loc of locales) {
            if (txt in translations[loc]) {
                continue
            }
            added = true
            translations[loc][txt] = ''
        }
        return txt != null // whether handled successfully
    }
    for (const {start, end, txts} of walkScript(ast.instance?.content?.body ?? [])) {
        for (const node of txts) {
            handleScriptNode(node)
        }
        mstr.prependLeft(start, '$derived(')
        mstr.appendRight(end, ')')
    }
    let iSnippetInFile = 0
    for (const node of walkHTML(ast.html)) {
        let txt
        let repl
        if (node.type === 'Text') {
            txt = node.data
            repl = `{t('${escapeQuote(txt)}')}`
            mstr.update(node.start, node.end, repl)
        } else if (node.type === 'CompoundText') {
            txt = node.data
            const snippets = []
            const nonTxtIs = []
            for (const [start, end] of node.tags) {
                nonTxtIs.push([start, end])
                const snippetName = `wSnip${iSnippetInFile}`
                const snippetBegin = `{#snippet ${snippetName}()}`
                const snippetEnd = '{/snippet}\n'
                mstr.appendRight(start, snippetBegin)
                mstr.prependLeft(end, snippetEnd)
                mstr.move(start, end, node.start)
                snippets.push(snippetName)
                iSnippetInFile++
            }
            for (const [start, end] of node.args) {
                nonTxtIs.push([start, end])
            }
            nonTxtIs.sort(([start1], [start2]) => start1 < start2 ? -1 : 1)
            let iNonTxt = 0
            for (const [start] of nonTxtIs.slice(1)) {
                mstr.remove(nonTxtIs[iNonTxt][1], start)
                iNonTxt++
            }
            if (node.args.length) {
                const firstArgStart = node.args[0][0]
                mstr.appendLeft(firstArgStart, 'args={[')
                for (const [start] of node.args) {
                    if (start > firstArgStart) {
                        mstr.prependLeft(start, ', ')
                    }
                }
                const lastArgEnd = node.args.slice(-1)[0][1]
                mstr.appendRight(lastArgEnd, ']} ')
            }
            mstr.update(node.start, nonTxtIs[0][0], `<T id={'${escapeQuote(txt)}'} tags={[${snippets.join(', ')}]} `)
            const lastNonTxtEnd = nonTxtIs.slice(-1)[0][1]
            if (lastNonTxtEnd === node.end) {
                mstr.prependRight(lastNonTxtEnd, ' />')
            } else {
                mstr.update(lastNonTxtEnd, node.end, ' />')
            }
        } else if (node.type === 'Attribute') {
            const value = node.value[0]
            txt = value.data
            repl = `{t('${escapeQuote(txt)}')}`
            let {start, end} = value
            if (`'"`.includes(content[start - 1])) {
                start--
                end++
            }
            mstr.update(start, end, repl)
        } else if (!handleScriptNode(node)) {
            console.error('Unexpected node in markup', node)
        }
        if (!txt) {
            continue
        }
        needImport = true
        for (const loc of locales) {
            if (txt in translations[loc]) {
                continue
            }
            added = true
            translations[loc][txt] = ''
        }
    }
    if (added) {
        for (const loc of locales) {
            writeFileSync(localeFile(loc), JSON.stringify(translations[loc], null, 2))
            writeFileSync(`${localesDir}${loc}.c.json`, JSON.stringify(compileTranslations(translations[loc]), null, 2))
        }
    }
    if (needImport) {
        const importStmt = 'import T, {t} from "~/i18n/runtime.svelte"'
        if (ast.instance) {
            mstr.appendRight(ast.instance.content.start, importStmt)
        } else {
            mstr.prepend(`<script>${importStmt}</script>\n`)
        }
    }
    return {
        code: mstr.toString(),
    }
}

export default {
    markup: preprocess,
}

const content = readFileSync('../../rnd/foo.svelte').toString()
console.log(preprocess({content, filename: 'foo'}).code)
