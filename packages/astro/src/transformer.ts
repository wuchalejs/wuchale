import MagicString from 'magic-string'
import { Parser } from 'acorn'
import { Message } from 'wuchale'
import { tsPlugin } from '@sveltejs/acorn-typescript'
import type * as Estree from 'acorn'
import { Transformer, scriptParseOptionsWithComments } from 'wuchale/adapter-vanilla'
import type {
    IndexTracker,
    HeuristicFunc,
    TransformOutput,
    RuntimeConf,
    CatalogExpr,
    CodePattern,
    UrlMatcher,
} from 'wuchale'
import { nonWhitespaceText, MixedVisitor, processCommentDirectives, type CommentDirectives } from "wuchale/adapter-utils"
import { parse } from '@astrojs/compiler'
import { is } from '@astrojs/compiler/utils'
import type {
    Node as AstroNode,
    ParentNode,
    ElementNode,
    ComponentNode,
    TextNode,
    FrontmatterNode,
    AttributeNode,
    ExpressionNode,
    CommentNode,
} from '@astrojs/compiler/types'

const rtComponent = 'W_tx_'

// Astro nodes that can have children
const nodesWithChildren = ['element', 'component', 'custom-element', 'fragment']

/**
 * MixedVisitor requires nodes with `start`/`end` properties (BasicNode constraint),
 * but Astro nodes use `position.start.offset`/`position.end.offset`.
 *
 * We provide a custom `getRange` function to bridge this, but TypeScript's generic
 * constraint is too strict. The callbacks (getTextContent, getCommentData, etc.) are
 * only called after corresponding type guards (isText, isComment) so they're safe at runtime.
 *
 * Using `any` here is intentional - the actual node types are:
 * ElementNode | ComponentNode | CustomElementNode | FragmentNode | TextNode | ExpressionNode | CommentNode
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MixedAstroNodes = any

/**
 * Find the position of the matching closing brace, handling:
 * - Nested braces
 * - String literals (single, double, template)
 * - Escaped characters
 *
 * @param content The content to search in
 * @param openPos Position of the opening brace
 * @returns Position after the closing brace, or -1 if not found
 */
function findMatchingBrace(content: string, openPos: number): number {
    let depth = 0
    let inString: string | null = null
    let i = openPos

    while (i < content.length) {
        const char = content[i]
        const prevChar = i > 0 ? content[i - 1] : ''

        // Handle escape sequences (skip next char if escaped)
        if (prevChar === '\\' && inString) {
            i++
            continue
        }

        // Handle string boundaries
        if (!inString) {
            if (char === '"' || char === "'" || char === '`') {
                inString = char
            } else if (char === '{') {
                depth++
            } else if (char === '}') {
                depth--
                if (depth === 0) {
                    return i + 1 // Position after the closing brace
                }
            }
        } else if (char === inString) {
            // Check for template literal ${} - don't exit string for nested braces
            if (inString === '`' && i + 1 < content.length && content[i + 1] === '{') {
                // Template literal, skip the ${ and continue
            }
            inString = null
        }

        i++
    }

    return -1 // No matching brace found
}

/**
 * Configuration options for the Astro transformer
 */
export interface AstroTransformerConfig {
    /**
     * Path to import the runtime loader from.
     * @default '@/locales/astro.loader.js'
     */
    loaderImportPath?: string

    /**
     * Path to import the runtime component from.
     * @default '@wuchale/astro/runtime.jsx'
     */
    componentImportPath?: string
}

const defaultConfig: Required<AstroTransformerConfig> = {
    loaderImportPath: '@/locales/astro.loader.js',
    componentImportPath: '@wuchale/astro/runtime.jsx',
}

export class AstroTransformer extends Transformer {
    // state
    currentElement?: string
    inCompoundText: boolean = false
    commentDirectivesStack: CommentDirectives[] = []
    lastVisitIsComment: boolean = false
    currentAstroKey: number = 0

    // Frontmatter position tracking
    frontmatterStart: number = 0
    frontmatterEnd: number = 0
    frontmatterContent: string = ''

    // Configuration
    private config: Required<AstroTransformerConfig>

    mixedVisitor!: MixedVisitor<MixedAstroNodes>

    constructor(
        content: string,
        filename: string,
        index: IndexTracker,
        heuristic: HeuristicFunc,
        patterns: CodePattern[],
        catalogExpr: CatalogExpr,
        rtConf: RuntimeConf,
        matchUrl: UrlMatcher,
        config: AstroTransformerConfig = {}
    ) {
        super(content, filename, index, heuristic, patterns, catalogExpr, rtConf, matchUrl)
        this.config = { ...defaultConfig, ...config }
    }

    initMixedVisitor = () => new MixedVisitor<MixedAstroNodes>({
        mstr: this.mstr,
        vars: this.vars,
        getRange: node => ({
            start: node.position?.start?.offset ?? 0,
            end: node.position?.end?.offset ?? 0
        }),
        isComment: node => node.type === 'comment',
        isText: node => node.type === 'text',
        leaveInPlace: () => false,
        isExpression: node => node.type === 'expression',
        getTextContent: (node: TextNode) => node.value,
        getCommentData: (node: CommentNode) => {
            const value = (node as any).value || ''
            return value.trim()
        },
        canHaveChildren: node => nodesWithChildren.includes(node.type),
        visitFunc: (child, inCompoundText) => {
            const inCompoundTextPrev = this.inCompoundText
            this.inCompoundText = inCompoundText
            const childTxts = this.visitAstroNode(child as AstroNode)
            this.inCompoundText = inCompoundTextPrev
            return childTxts
        },
        visitExpressionTag: (_node: ExpressionNode) => {
            // All expression processing is handled by visitAstroNode via visitFunc
            // Return empty to avoid double processing
            return []
        },
        fullHeuristicDetails: this.fullHeuristicDetails,
        checkHeuristic: this.getHeuristicMessageType,
        index: this.index,
        wrapNested: (msgInfo, hasExprs, nestedRanges, lastChildEnd) => {
            let begin = `<${rtComponent}`
            if (nestedRanges.length > 0) {
                for (const [i, [childStart, _, haveCtx]] of nestedRanges.entries()) {
                    let toAppend: string
                    if (i === 0) {
                        toAppend = `${begin} t={[`
                    } else {
                        toAppend = ', '
                    }
                    this.mstr.appendRight(childStart, `${toAppend}${haveCtx ? this.vars().nestCtx : '()'} => `)
                }
                begin = `]}`
            }
            begin += ' x='
            if (this.inCompoundText) {
                begin += `{${this.vars().nestCtx}} n`
            } else {
                const index = this.index.get(msgInfo.toKey())
                begin += `{${this.vars().rtCtx}(${index})}`
            }
            let end = ' />'
            if (hasExprs) {
                begin += ' a={['
                end = ']}' + end
            }
            this.mstr.appendLeft(lastChildEnd, begin)
            this.mstr.appendRight(lastChildEnd, end)
        },
    })

    visitChildren = (node: ParentNode): Message[] => {
        if (!('children' in node) || !node.children) {
            return []
        }
        return this.mixedVisitor.visit({
            children: node.children as MixedAstroNodes[],
            commentDirectives: this.commentDirectives,
            inCompoundText: this.inCompoundText,
            scope: 'markup',
            element: this.currentElement as string,
        })
    }

    visitTextNode = (node: TextNode): Message[] => {
        const [, trimmed] = nonWhitespaceText(node.value)
        if (!trimmed) {
            return []
        }
        // Skip text that looks like a string literal (quotes on both ends)
        // This prevents double-bracing when text nodes inside expressions are processed
        if (/^(["'`]).+\1$/s.test(trimmed)) {
            return []
        }
        const [pass, msgInfo] = this.checkHeuristic(trimmed, {
            scope: 'markup',
            element: this.currentElement,
        })
        if (!pass) {
            return []
        }
        // Use node offset as a starting point, but find the actual text in content
        // This handles byte-offset vs character-offset mismatches (UTF-8 multi-byte chars)
        const approxStart = node.position?.start?.offset ?? 0
        // Search for the trimmed text in the vicinity of the approximate position
        const searchStart = Math.max(0, approxStart - 50)
        const searchEnd = Math.min(this.content.length, approxStart + node.value.length + 50)
        const searchRegion = this.content.slice(searchStart, searchEnd)
        const textIndex = searchRegion.indexOf(trimmed)
        if (textIndex === -1) {
            return [] // Couldn't find text, skip
        }
        const start = searchStart + textIndex
        const end = start + trimmed.length
        this.mstr.update(
            start,
            end,
            `{${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`,
        )
        return [msgInfo]
    }

    visitElementNode = (node: ElementNode | ComponentNode): Message[] => {
        const currentElement = this.currentElement
        this.currentElement = node.name

        // Transform attributes first (for consistent index ordering)
        const msgs: Message[] = []
        for (const attr of node.attributes) {
            msgs.push(...this.visitAttribute(attr))
        }

        // Then process children
        msgs.push(...this.visitChildren(node))

        // Add key for elements in compound text
        if (this.inCompoundText) {
            const hasKey = node.attributes.some(attr => attr.name === 'key')
            if (!hasKey && node.position?.start?.offset != null) {
                // Find the position after the element name
                const nameEnd = this.findNameEnd(node)
                if (nameEnd > 0) {
                    this.mstr.appendLeft(nameEnd, ` key="_${this.currentAstroKey}"`)
                    this.currentAstroKey++
                }
            }
        }

        this.currentElement = currentElement
        return msgs
    }

    findNameEnd(node: ElementNode | ComponentNode): number {
        // Find where the element name ends in the source
        const start = node.position?.start?.offset ?? 0
        const content = this.content.slice(start)
        const match = content.match(/^<\s*[\w.-]+/)
        if (match) {
            return start + match[0].length
        }
        return 0
    }

    /**
     * Visit spread attributes like {...props} or {...{title: "Hello"}}
     * The value contains the expression after the ...
     */
    visitSpreadAttribute = (attr: AttributeNode): Message[] => {
        if (!attr.value) {
            return []
        }

        // Parse the spread expression using Acorn
        const TsParser = Parser.extend(tsPlugin())
        const [opts] = scriptParseOptionsWithComments()

        let exprAst: Estree.Program
        try {
            // Wrap in parentheses to parse as expression
            exprAst = TsParser.parse(`(${attr.value})`, opts)
        } catch {
            // Can't parse, skip
            return []
        }

        // Get the expression from the program
        const exprStmt = exprAst.body[0]
        if (exprStmt?.type !== 'ExpressionStatement') {
            return []
        }

        // Find the spread in source to get offset for transformations
        const attrStart = attr.position?.start?.offset
        if (attrStart == null) {
            return []
        }

        // The spread looks like {...expr} in source
        // We need to find where the expression starts after {...
        const searchContent = this.content.slice(attrStart)
        const spreadMatch = searchContent.match(/^\{\s*\.\.\./)
        if (!spreadMatch) {
            return []
        }

        // Calculate offset: position of { + length of {...
        // The parsed expression positions are 0-based from (expr)
        // We need to adjust by attrStart + spreadMatch.length - 1 (for the added '(')
        const contentOffset = attrStart + spreadMatch[0].length - 1

        // Use offset-adjusted MagicString
        const originalMstr = this.mstr
        this.mstr = this.createOffsetMstr(contentOffset)

        const msgs: Message[] = []
        try {
            msgs.push(...this.visit(exprStmt.expression as Estree.AnyNode))
        } finally {
            this.mstr = originalMstr
        }

        return msgs
    }

    visitAttribute = (attr: AttributeNode): Message[] => {
        // Handle spread attributes: {...props} or {...{title: "Hello"}}
        if (attr.kind === 'spread') {
            return this.visitSpreadAttribute(attr)
        }

        // Skip Astro directives (client:, is:, set:, transition:, etc.)
        if (attr.name.includes(':')) {
            return []
        }

        // Handle quoted string attributes: title="string"
        if (attr.kind === 'quoted' && attr.value) {
            const [pass, msgInfo] = this.checkHeuristic(attr.value, {
                scope: 'script' as 'script',
                element: this.currentElement,
                attribute: attr.name,
            })
            if (!pass) {
                return []
            }

            const attrStart = attr.position?.start?.offset
            if (attrStart == null) {
                return []
            }

            // Astro compiler doesn't provide end position for attributes
            // Find the attribute end by searching for the closing quote
            const searchContent = this.content.slice(attrStart)
            // Match: name="value" or name='value'
            const attrMatch = searchContent.match(/^[\w.-]+\s*=\s*(["'])(?:[^"'\\]|\\.)*\1/)
            if (!attrMatch) {
                return []
            }
            const attrEnd = attrStart + attrMatch[0].length

            const attrContent = attrMatch[0]
            const valueMatch = attrContent.match(/=\s*["'](.*)["']$/)
            if (valueMatch) {
                const valueStart = attrStart + attrContent.indexOf(valueMatch[0])
                this.mstr.update(
                    valueStart,
                    attrEnd,
                    `={${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`,
                )
            }

            return [msgInfo]
        }

        // Handle expression attributes with string literals: title={"string"} or title={'string'}
        if (attr.kind === 'expression' && attr.value) {
            const exprContent = attr.value.trim()

            // Check for simple string literal (single or double quoted)
            const stringMatch = exprContent.match(/^(["'])(.+)\1$/)
            if (!stringMatch) {
                return [] // Not a simple string literal, skip (could be variable, template, etc.)
            }

            const stringValue = stringMatch[2]

            const [pass, msgInfo] = this.checkHeuristic(stringValue, {
                scope: 'script' as 'script',
                element: this.currentElement,
                attribute: attr.name,
            })
            if (!pass) {
                return []
            }

            const attrStart = attr.position?.start?.offset
            if (attrStart == null) {
                return []
            }

            // For expression attributes, we need to find the end by searching for the closing brace
            // The format is: name={value} where value is our string literal
            const searchContent = this.content.slice(attrStart)

            // Find where the opening brace is (after name=)
            const braceMatch = searchContent.match(/^[\w.-]+\s*=\s*\{/)
            if (!braceMatch) {
                return []
            }

            // Find the matching closing brace using proper string-aware matching
            const openBracePos = attrStart + braceMatch[0].length - 1 // Position of {
            const attrEnd = findMatchingBrace(this.content, openBracePos)
            if (attrEnd === -1) {
                return []
            }

            // Find where the = starts to calculate the replacement range
            const eqIndex = braceMatch[0].indexOf('=')
            const valueStart = attrStart + eqIndex
            this.mstr.update(
                valueStart,
                attrEnd,
                `={${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`,
            )

            return [msgInfo]
        }

        return []
    }

    visitCommentNode = (node: CommentNode): Message[] => {
        const value = (node as any).value || ''
        const commentContents = value.trim()
        if (!commentContents) {
            return []
        }
        this.commentDirectives = processCommentDirectives(commentContents, this.commentDirectives)
        if (this.lastVisitIsComment) {
            this.commentDirectivesStack[this.commentDirectivesStack.length - 1] = this.commentDirectives
        } else {
            this.commentDirectivesStack.push(this.commentDirectives)
        }
        this.lastVisitIsComment = true
        return []
    }

    visitAstroNode = (node: AstroNode): Message[] => {
        // Skip whitespace-only text nodes
        if (is.text(node) && !node.value.trim()) {
            return []
        }

        // Handle comments
        if (is.comment(node)) {
            return this.visitCommentNode(node)
        }

        let msgs: Message[] = []
        const commentDirectivesPrev = this.commentDirectives
        if (this.lastVisitIsComment) {
            this.commentDirectives = this.commentDirectivesStack.pop() as CommentDirectives
            this.lastVisitIsComment = false
        }
        if (this.commentDirectives.ignoreFile) {
            return []
        }
        if (this.commentDirectives.forceType !== false) {
            // Handle different node types
            if (is.text(node)) {
                msgs = this.visitTextNode(node)
            } else if (is.element(node) || is.component(node) || is.customElement(node)) {
                msgs = this.visitElementNode(node as ElementNode)
            } else if (is.fragment(node)) {
                msgs = this.visitChildren(node)
            } else if (is.expression(node)) {
                // Expression nodes contain template expressions like {someVar}
                if ('children' in node) {
                    // Special handling for string literals like {"text"} or {'text'}
                    if (node.children.length === 1 && is.text(node.children[0])) {
                        const textNode = node.children[0] as TextNode
                        const textValue = textNode.value.trim()
                        const stringMatch = textValue.match(/^(["'])(.+)\1$/s)
                        if (stringMatch) {
                            // This is a string literal expression
                            const stringValue = stringMatch[2]
                            const [pass, msgInfo] = this.checkHeuristic(stringValue, {
                                scope: 'markup',
                                element: this.currentElement,
                            })
                            if (pass) {
                                let start = node.position?.start?.offset
                                if (start == null) {
                                    return msgs // Skip if no start position
                                }
                                // Astro parser may report position before the opening brace
                                // Find the actual opening brace
                                while (start < this.content.length && this.content[start] !== '{') {
                                    start++
                                }
                                // Find the closing brace using proper string-aware matching
                                const end = findMatchingBrace(this.content, start)
                                // Skip if we couldn't find the closing brace
                                if (end === -1) {
                                    return msgs
                                }
                                // Replace entire {"..."} with {translated}
                                this.mstr.update(
                                    start,
                                    end,
                                    `{${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`,
                                )
                                msgs.push(msgInfo)
                            }
                            return msgs // Don't process children
                        }
                    }
                    // Not a simple string literal expression
                    // Don't process children - complex expressions contain JavaScript code
                    // that should be handled by the frontmatter transformer, not visitTextNode
                    // This prevents breaking ternaries, logical expressions, etc.
                }
            } else if (is.parent(node)) {
                msgs = this.visitChildren(node)
            }
        }
        this.commentDirectives = commentDirectivesPrev
        return msgs
    }

    async transformAstro(): Promise<TransformOutput> {
        // Parse the Astro file
        const { ast } = await parse(this.content, { position: true })

        this.mstr = new MagicString(this.content)
        this.mixedVisitor = this.initMixedVisitor()
        this.currentAstroKey = 0

        const allMsgs: Message[] = []

        // Find and process frontmatter first
        let frontmatterNode: FrontmatterNode | null = null
        for (const child of ast.children) {
            if (is.frontmatter(child)) {
                frontmatterNode = child
                break
            }
        }

        if (frontmatterNode) {
            this.frontmatterStart = frontmatterNode.position?.start?.offset ?? 0
            this.frontmatterEnd = frontmatterNode.position?.end?.offset ?? 0
            this.frontmatterContent = frontmatterNode.value

            // Transform the frontmatter code
            const frontmatterMsgs = await this.transformFrontmatter(frontmatterNode)
            allMsgs.push(...frontmatterMsgs)
        }

        // Walk the template (everything except frontmatter)
        for (const child of ast.children) {
            if (!is.frontmatter(child)) {
                const templateMsgs = this.visitAstroNode(child)
                allMsgs.push(...templateMsgs)
            }
        }

        // Inject runtime import and initialization
        this.injectRuntime(frontmatterNode)

        return this.finalizeAstro(allMsgs)
    }

    /**
     * Creates an offset-adjusted MagicString wrapper.
     * All position operations are offset by the given amount.
     * This is safer than monkey-patching the original methods.
     */
    private createOffsetMstr(offset: number): MagicString {
        const original = this.mstr
        // Use Proxy to intercept position-based operations
        return new Proxy(original, {
            get(target, prop) {
                const value = target[prop as keyof MagicString]
                if (typeof value !== 'function') return value

                // Offset position arguments for these methods
                switch (prop) {
                    case 'update':
                        return (start: number, end: number, content: string) =>
                            target.update(start + offset, end + offset, content)
                    case 'appendLeft':
                        return (pos: number, content: string) =>
                            target.appendLeft(pos + offset, content)
                    case 'appendRight':
                        return (pos: number, content: string) =>
                            target.appendRight(pos + offset, content)
                    case 'prependLeft':
                        return (pos: number, content: string) =>
                            target.prependLeft(pos + offset, content)
                    case 'prependRight':
                        return (pos: number, content: string) =>
                            target.prependRight(pos + offset, content)
                    case 'overwrite':
                        return (start: number, end: number, content: string) =>
                            target.overwrite(start + offset, end + offset, content)
                    case 'remove':
                        return (start: number, end: number) =>
                            target.remove(start + offset, end + offset)
                    default:
                        return value.bind(target)
                }
            }
        }) as MagicString
    }

    async transformFrontmatter(node: FrontmatterNode): Promise<Message[]> {
        const scriptContent = node.value
        if (!scriptContent.trim()) {
            return []
        }

        // The frontmatter content starts after the opening ---
        // node.value is the content between --- delimiters, including the leading newline
        // Find the actual position of --- in the file content
        const frontmatterStart = node.position?.start?.offset ?? 0
        const searchContent = this.content.slice(frontmatterStart)
        // Match optional whitespace, then ---, then optional whitespace/newline before content
        const dashMatch = searchContent.match(/^[\s]*---/)
        const contentOffset = frontmatterStart + (dashMatch ? dashMatch[0].length : 3)

        // Parse the script content with Acorn (TypeScript support)
        const TsParser = Parser.extend(tsPlugin())
        const [opts, comments] = scriptParseOptionsWithComments()

        let scriptAst: Estree.Program
        try {
            scriptAst = TsParser.parse(scriptContent, { ...opts, allowReturnOutsideFunction: true })
        } catch (e) {
            // If parsing fails, skip frontmatter transformation
            console.warn(`Failed to parse frontmatter in ${this.filename}:`, e)
            return []
        }

        this.comments = comments

        // Use offset-adjusted MagicString for frontmatter transformation
        // This is cleaner than monkey-patching the original methods
        const originalMstr = this.mstr
        this.mstr = this.createOffsetMstr(contentOffset)

        const msgs: Message[] = []
        try {
            // Visit the script AST
            for (const statement of scriptAst.body) {
                msgs.push(...this.visit(statement as Estree.AnyNode))
            }
        } finally {
            // Always restore original mstr, even if an exception occurs
            this.mstr = originalMstr
        }

        return msgs
    }

    injectRuntime(frontmatterNode: FrontmatterNode | null) {
        const { loaderImportPath, componentImportPath } = this.config
        const runtimeImport = `import { getRuntime as _w_load_ } from '${loaderImportPath}';\n`
        const runtimeInit = `const ${this.currentRtVar} = _w_load_('astro');\n`

        if (frontmatterNode) {
            const frontmatterStart = frontmatterNode.position?.start?.offset ?? 0

            // Find the position after the opening --- and newline
            // The frontmatter format is: ---\n<content>\n---
            // Handle leading whitespace from template literals
            const searchContent = this.content.slice(frontmatterStart)
            const dashMatch = searchContent.match(/^[\s]*---[ \t]*\n?/)
            const insertOffset = dashMatch ? dashMatch[0].length : 4
            const insertPos = frontmatterStart + insertOffset

            // Insert import AND runtime init at the start of frontmatter content
            // This ensures _w_runtime_ is available for any transformed code below
            this.mstr.appendRight(insertPos, runtimeImport + runtimeInit)
        } else {
            // No frontmatter exists, create one
            const frontmatter = `---\n${runtimeImport}${runtimeInit}---\n\n`
            this.mstr.prepend(frontmatter)
        }

        // Also import W_tx_ component if we have mixed content
        if (this.currentAstroKey > 0) {
            const componentImport = `import ${rtComponent} from "${componentImportPath}";\n`
            if (frontmatterNode) {
                const frontmatterStart = frontmatterNode.position?.start?.offset ?? 0
                const searchContent = this.content.slice(frontmatterStart)
                const dashMatch = searchContent.match(/^[\s]*---[ \t]*\n?/)
                const insertOffset = dashMatch ? dashMatch[0].length : 4
                const insertPos = frontmatterStart + insertOffset
                this.mstr.appendRight(insertPos, componentImport)
            }
        }
    }

    finalizeAstro(msgs: Message[]): TransformOutput {
        const hasChanges = msgs.length > 0 || this.mstr.hasChanged()
        const mstr = this.mstr

        return {
            output: (_header: string) => {
                if (!hasChanges) {
                    return {}
                }
                return {
                    code: mstr.toString(),
                    map: mstr.generateMap({ hires: true }),
                }
            },
            msgs,
        }
    }
}
