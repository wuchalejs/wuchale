// $$ cd .. && node preprocess/index.test.js
import { parse } from "svelte/compiler"
import {writeFileSync, readFileSync} from 'node:fs'
import MagicString from "magic-string"
import compileTranslations from "./compile.js"

const defaultMstr = new MagicString('')

const avoidSurroundCalls = ['$derived', '$state', '$effect', '$props']
const snipPrefix = 'wSnippet'

const defaultOptions = {locales: [], localesDir: ''}

class Preprocess {
    constructor(options = defaultOptions) {
        this.locales = options.locales
        this.localesDir = options.localesDir
        this.translations = {}
        for (const loc of this.locales) {
            try {
                const contents = readFileSync(this.localeFile(loc))
                this.translations[loc] = JSON.parse(contents.toString() || '{}')
            } catch (err) {
                if (err.code === 'ENOENT') {
                    this.translations[loc] = {}
                } else {
                    throw err
                }
            }
        }
        this.content = ''
        this.mstr = defaultMstr
        this.markupStart = 0
        this.iSnippetInFile = 0
    }

    localeFile = loc => `${this.localesDir}/${loc}.json`
    escapeQuote = txt => txt.replace("'", "\\'")
    getArgs = (content, node) => node.args.map(([start, end]) => content.slice(start, end))

    visitLiteral = node => {
        if (typeof node.value !== 'string' || !node.value.startsWith('+')) {
            return []
        }
        const txt = node.value.slice(1)
        // this.extractTxt(txt)
        this.mstr.update(node.start, node.end, `t('${this.escapeQuote(txt)}')`)
        return [txt]
    }

    visitArrayExpression = node => {
        const txts = []
        for (const elm of node.elements) {
            txts.push(...this.visit(elm))
        }
        return txts
    }

    visitObjectExpression = node => {
        const txts = []
        for (const prop of node.properties) {
            txts.push(...this.visit(prop.key))
            txts.push(...this.visit(prop.value))
        }
        return txts
    }

    visitMemberExpression = node => {
        return [
            ...this.visit(node.object),
            ...this.visit(node.property),
        ]
    }

    visitCallExpression = node => {
        const txts = [...this.visit(node.callee)]
        for (const arg of node.arguments) {
            txts.push(...this.visit(arg))
        }
        return txts
    }

    visitVariableDeclaration = node => {
        const txts = []
        for (const dec of node.declarations) {
            if (!dec.init) {
                continue
            }
            const decVisit = this.visit(dec.init)
            if (!decVisit.length) {
                continue
            }
            txts.push(...decVisit)
            if (dec.init.type === 'CallExpression' && dec.init.callee.type === 'Identifier' && avoidSurroundCalls.includes(dec.init.callee.name)) {
                continue
            }
            this.mstr.prependLeft(dec.init.start, '$derived(')
            this.mstr.appendRight(dec.init.end, ')')
        }
        return txts
    }

    visitTemplateLiteral = node => {
        const txts = []
        const quasi0 = node.quasis[0]
        let txt = quasi0.value.cooked
        for (const [i, expr] of node.expressions.entries()) {
            txts.push(...this.visit(expr))
            const quasi = node.quasis[i + 1]
            txt += `{${i}}${quasi.value.cooked}`
            this.mstr.remove(quasi.start - 1, quasi.end)
            if (i + 1 === node.expressions.length) {
                continue
            }
            this.mstr.update(quasi.end, quasi.end + 2, ', ')
        }
        if (!quasi0.value.cooked.startsWith('+')) {
            return txts
        }
        let repl = `t('${this.escapeQuote(txt)}'`
        if (node.expressions.length) {
            repl += ', '
        }
        this.mstr.update(quasi0.start - 1, quasi0.end + 2, repl)
        this.mstr.update(node.end - 1, node.end, ')')
        txts.push(txt)
        return txts
    }


    visitText = node => {
        let txt = node.data.replace(/\s+/g, ' ')
        let ttxt = txt.trim()
        if (!ttxt || ttxt.startsWith('-')) {
            return []
        }
        this.mstr.update(node.start, node.end, `{t('${this.escapeQuote(txt)}')}`)
        return [txt]
    }

    visitMustacheTag = node => {
        return this.visit(node.expression)
    }

    visitComment = node => {
        return []
    }

    checkInCompoundText = node => {
        if (node.inCompoundText) {
            return true
        }
        let text = false
        let nonText = false
        for (const child of node.children ?? []) {
            if (child.type === 'Text') {
                if (child.data.trim()) {
                    text = true
                }
            } else {
                nonText = true
            }
        }
        return text && nonText // mixed content
    }

    visitElement = node => {
        const txts = []
        for (const attrib of node.attributes) {
            txts.push(...this.visitAttribute(attrib))
        }
        let txt = ''
        let iArg = 0
        let iTag = 0
        const inCompoundText = this.checkInCompoundText(node)
        for (const [i, child] of node.children.entries()) {
            if (!inCompoundText) {
                txts.push(...this.visit(child))
                continue
            }
            if (child.type === 'Text') {
                txt += child.data
                if (node.inCompoundText) {
                    this.mstr.update(child.start, child.end, `{ctx[${i + 1}]}`)
                } else {
                    this.mstr.remove(child.start, child.end)
                }
                continue
            }
            if (child.type === 'MustacheTag') {
                txts.push(...this.visitMustacheTag(child))
                txt += `{${iArg}}`
                if (!node.inCompoundText) {
                    if (iArg > 0) {
                        this.mstr.update(child.start, child.start + 1, ', ')
                    } else {
                        this.mstr.remove(child.start, child.start + 1)
                    }
                    this.mstr.remove(child.end - 1, child.end)
                }
                iArg++
                continue
            }
            child.inCompoundText = true
            // elements
            let chTxt = this.visit(child).join()
            if (chTxt && child.children) {
                chTxt = `<${iTag}>${chTxt}</${iTag}>`
                const snippetName = `${snipPrefix}${iTag}`
                const snippetBegin = `\n{#snippet ${snippetName}(ctx)}\n`
                const snippetEnd = '\n{/snippet}\n'
                this.mstr.appendRight(child.start, snippetBegin)
                this.mstr.prependLeft(child.end, snippetEnd)
                this.mstr.move(child.start, child.end, node.start)
                iTag++
            }
            txt += chTxt
        }
        if (!txt.trim()) {
            return txts
        }
        txts.push(txt)
        const firstChildStart = node.children[0].start
        const lastChildEnd = node.children.slice(-1)[0].end
        if (iTag > 0) {
            const snippets = []
            // reference all new snippets added
            for (let i = 0; i < iTag; i++) {
                snippets.push(`${snipPrefix}${i}`)
            }
            this.mstr.appendLeft(firstChildStart, `<T id={'${this.escapeQuote(txt)}'} tags={[${snippets.join(', ')}]} `)
            if (iArg > 0) {
                this.mstr.appendRight(firstChildStart, 'args={[')
                this.mstr.appendRight(lastChildEnd, ']}')
            }
            this.mstr.appendRight(lastChildEnd, '/>')
        } else if (!node.inCompoundText) {
            this.mstr.appendLeft(firstChildStart, `{t('${this.escapeQuote(txt)}', `)
            this.mstr.appendRight(lastChildEnd, ')}')
        }
                console.log(txt, iTag)
        return txts
    }

    visitAttribute = node => {
        // no idea why value is an array, take the first one to decide the type of enclosure ("" vs {})
        let value = node.value
        if (node.value && node.value !== true) {
            value = node.value[0]
        }
        if (value.type !== 'Text') {
            return this.visit(value)
        }
        if (!value.data.trim().startsWith('+')) {
            return []
        }
        const txts = this.visit(value)
        if (!txts.length) {
            return txts
        }
        let {start, end} = value
        if (!`'"`.includes(this.content[start - 1])) {
            return txts
        }
        this.mstr.remove(start - 1, start)
        this.mstr.remove(end, end + 1)
        return txts
    }

    visit = node => {
        const methodName = `visit${node.type}`
        if (methodName in this) {
            return this[methodName](node)
        }
        // console.log(node)
        return []
    }

    process = ({ content, filename }) => {
        this.content = content
        this.mstr = new MagicString(content)
        const ast = parse(content, {filename})
        const txts = []
        for (const node of ast.instance?.content?.body ?? []) {
            txts.push(...this.visit(node))
        }
        this.markupStart = ast.html.children[0].start
        for (const node of ast.html.children) {
            txts.push(...this.visit(node))
        }
        if (!txts.length) {
            return {}
        }
        let added = false
        for (const loc of this.locales) {
            for (const txt of txts) {
                if (txt in this.translations[loc]) {
                    continue
                }
                this.translations[loc][txt] = ''
                added = true
            }
        }
        if (added) {
            for (const loc of this.locales) {
                writeFileSync(this.localeFile(loc), JSON.stringify(this.translations[loc], null, 2))
                writeFileSync(`${this.localesDir}/${loc}.c.json`, JSON.stringify(compileTranslations(this.translations[loc]), null, 2))
            }
        }
        const importStmt = 'import T, {Tx, t} from "~/i18n/runtime.svelte"'
        if (ast.instance) {
            this.mstr.appendRight(ast.instance.content.start, importStmt)
        } else {
            this.mstr.prepend(`<script>${importStmt}</script>\n`)
        }
        return {
            code: this.mstr.toString(),
        }
    }
}

export default function setupPreprocess(options = defaultOptions) {
    return {
        markup: new Preprocess(options).process,
    }
}
