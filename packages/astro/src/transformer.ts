import MagicString from "magic-string";
import { Parser } from "acorn";
import { Message } from "wuchale";
import { tsPlugin } from "@sveltejs/acorn-typescript";
import type * as Estree from "acorn";
import { createHash } from "node:crypto";
import {
  Transformer,
  scriptParseOptionsWithComments,
} from "wuchale/adapter-vanilla";
import type {
  IndexTracker,
  HeuristicFunc,
  TransformOutput,
  AuxiliaryFile,
  RuntimeConf,
  CatalogExpr,
  CodePattern,
  UrlMatcher,
} from "wuchale";
import {
  nonWhitespaceText,
  MixedVisitor,
  processCommentDirectives,
  type CommentDirectives,
} from "wuchale/adapter-utils";
import { parse } from "@astrojs/compiler";
import { is } from "@astrojs/compiler/utils";
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
} from "@astrojs/compiler/types";

const rtComponent = "W_tx_";

// Astro nodes that can have children
const nodesWithChildren = [
  "element",
  "component",
  "custom-element",
  "fragment",
];

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
type MixedAstroNodes = any;

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
  let depth = 0;
  let inString: string | null = null;
  let i = openPos;

  while (i < content.length) {
    const char = content[i];
    const prevChar = i > 0 ? content[i - 1] : "";

    // Handle escape sequences (skip next char if escaped)
    if (prevChar === "\\" && inString) {
      i++;
      continue;
    }

    // Handle string boundaries
    if (!inString) {
      if (char === '"' || char === "'" || char === "`") {
        inString = char;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          return i + 1; // Position after the closing brace
        }
      }
    } else if (char === inString) {
      // Check for template literal ${} - don't exit string for nested braces
      if (
        inString === "`" &&
        i + 1 < content.length &&
        content[i + 1] === "{"
      ) {
        // Template literal, skip the ${ and continue
      }
      inString = null;
    }

    i++;
  }

  return -1; // No matching brace found
}

/**
 * Configuration options for the Astro transformer
 */
export interface AstroTransformerConfig {
  /**
   * Path to import the runtime component from.
   * @default '@wuchale/astro/runtime.astro'
   */
  componentImportPath?: string;
}

const defaultConfig: Required<AstroTransformerConfig> = {
  componentImportPath: "@wuchale/astro/runtime.astro",
};

export class AstroTransformer extends Transformer {
  // state
  currentElement?: string;
  inCompoundText: boolean = false;
  commentDirectivesStack: CommentDirectives[] = [];
  lastVisitIsComment: boolean = false;

  // Wrapper component generation state
  // Store wrapper metadata for later file generation (hash -> { importName, transformedContent })
  private wrapperMetadata: Map<
    string,
    { importName: string; transformedContent: string; index: number }
  > = new Map();
  private wrapperCounter: number = 0;

  // Frontmatter position tracking
  frontmatterStart: number = 0;
  frontmatterEnd: number = 0;
  frontmatterContent: string = "";

  // Position to insert the loader import header (inside frontmatter)
  private headerInsertPos: number = 0;

  // Whether the original file had frontmatter
  private hadFrontmatter: boolean = false;

  // Content to add to frontmatter (runtime init, imports, etc.)
  private frontmatterAdditions: string = "";

  // Catalog expression for runtime initialization (stored for use in injectRuntime)
  private catalogExpr: CatalogExpr;

  // Configuration
  private config: Required<AstroTransformerConfig>;

  mixedVisitor!: MixedVisitor<MixedAstroNodes>;

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
    super(
      content,
      filename,
      index,
      heuristic,
      patterns,
      catalogExpr,
      rtConf,
      matchUrl
    );
    this.catalogExpr = catalogExpr;
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Store metadata for a wrapper component to be generated later.
   * The actual file content is created in finalizeAstro when we have access to the header.
   * Returns the import name for use in the transformed code.
   *
   * Architecture:
   * - Wrapper components are generated .astro files stored in {localesDir}/.wuchale/
   * - Each wrapper wraps a nested element (e.g., <b>, <a>, <Component>) from translations
   * - Wrappers are deduplicated by content hash - identical nested elements share a wrapper
   * - File naming: w_{index}_{hash}.astro (e.g., w_0_a1b2c3d4.astro)
   *
   * @param originalContent - The original nested element HTML (e.g., "<b>text</b>")
   * @param hasContext - true if nested element has translatable text that needs tx(ctx)
   */
  private generateWrapper(
    originalContent: string,
    hasContext: boolean
  ): { importName: string } {
    // Create a content hash for deduplication (based on original content + hasContext)
    const hash = createHash("md5")
      .update(originalContent + (hasContext ? "_ctx" : ""))
      .digest("hex")
      .slice(0, 8);

    // Check if we already have a wrapper with this content
    if (this.wrapperMetadata.has(hash)) {
      return { importName: this.wrapperMetadata.get(hash)!.importName };
    }

    const index = this.wrapperCounter;
    const importName = `_w_tag_${index}`;
    this.wrapperCounter++;

    // Transform content: only replace text with tx(ctx) if hasContext is true
    // If hasContext is false, keep original text (it's not translatable)
    const transformedContent = hasContext
      ? this.transformWrapperContent(originalContent)
      : originalContent;

    // Store metadata - actual file content is generated in finalizeAstro
    this.wrapperMetadata.set(hash, { importName, transformedContent, index });

    return { importName };
  }

  /**
   * Transform original nested element content to replace text with runtime tx(ctx) call.
   * Only called when hasContext is true (content is translatable).
   *
   * Supported patterns:
   * - <b>text</b> -> <b>{_w_runtime_.tx(ctx)}</b>
   * - <a href="/x">text</a> -> <a href="/x">{_w_runtime_.tx(ctx)}</a>
   * - <Component>text</Component> -> <Component>{_w_runtime_.tx(ctx)}</Component>
   *
   * Limitation: Uses simple regex that only handles the first text node.
   * Nested elements like <a><span>text</span></a> are not fully supported.
   * This is acceptable because the MixedVisitor only extracts single-level nested elements.
   */
  private transformWrapperContent(content: string): string {
    // Handle self-closing tags - they don't have text to replace
    if (/^<[^>]+\/>$/.test(content.trim())) {
      return content;
    }

    // Replace text content with tx(ctx) call
    // Pattern: find text between > and </ (innermost text)
    // This handles: <b>text</b> -> <b>{_w_runtime_.tx(ctx)}</b>
    // And: <a href="/x">text</a> -> <a href="/x">{_w_runtime_.tx(ctx)}</a>
    return content.replace(/>([^<]+)<\//, (match, text) => {
      const trimmed = text.trim();
      if (trimmed) {
        // Replace text with runtime call, preserving surrounding whitespace
        const leadingWs = text.match(/^\s*/)?.[0] || "";
        const trailingWs = text.match(/\s*$/)?.[0] || "";
        return `>${leadingWs}{_w_runtime_.tx(ctx)}${trailingWs}</`;
      }
      return match;
    });
  }

  initMixedVisitor = () =>
    new MixedVisitor<MixedAstroNodes>({
      mstr: this.mstr,
      vars: this.vars,
      getRange: (node) => ({
        start: node.position?.start?.offset ?? 0,
        end: node.position?.end?.offset ?? 0,
      }),
      isComment: (node) => node.type === "comment",
      isText: (node) => node.type === "text",
      // <slot> elements should be left in place - they're pass-through elements
      // that receive children from the parent component, not translation content
      leaveInPlace: (node) => node.type === "element" && node.name === "slot",
      isExpression: (node) => node.type === "expression",
      getTextContent: (node: TextNode) => node.value,
      getCommentData: (node: CommentNode) => {
        const value = (node as any).value || "";
        return value.trim();
      },
      canHaveChildren: (node) => nodesWithChildren.includes(node.type),
      visitFunc: (child, inCompoundText) => {
        const inCompoundTextPrev = this.inCompoundText;
        this.inCompoundText = inCompoundText;
        const childTxts = this.visitAstroNode(child as AstroNode);
        this.inCompoundText = inCompoundTextPrev;
        return childTxts;
      },
      visitExpressionTag: (_node: ExpressionNode) => {
        // All expression processing is handled by visitAstroNode via visitFunc
        // Return empty to avoid double processing
        return [];
      },
      fullHeuristicDetails: this.fullHeuristicDetails,
      checkHeuristic: this.getHeuristicMessageType,
      index: this.index,
      wrapNested: (msgInfo, hasExprs, nestedRanges, lastChildEnd) => {
        let begin = `<${rtComponent}`;
        const tagRefs: string[] = [];

        if (nestedRanges.length > 0) {
          for (const [childStart, childEnd, haveCtx] of nestedRanges) {
            // Extract ORIGINAL nested element content (positions are from AST)
            // mstr.slice() is unreliable after transformations - use original content
            // Note: Astro AST sometimes reports end position incorrectly for elements
            // Find the actual end by looking for the closing > character
            let adjustedEnd = childEnd;
            if (this.content[childEnd - 1] !== ">") {
              // Search forward for the closing >
              const searchEnd = Math.min(childEnd + 20, this.content.length);
              for (let i = childEnd; i < searchEnd; i++) {
                if (this.content[i] === ">") {
                  adjustedEnd = i + 1;
                  break;
                }
              }
            }
            const originalContent = this.content.slice(childStart, adjustedEnd);

            // Generate a wrapper component for this nested element
            const wrapper = this.generateWrapper(originalContent, haveCtx);
            tagRefs.push(wrapper.importName);

            // Remove the original nested element from output (use adjustedEnd for consistency)
            this.mstr.remove(childStart, adjustedEnd);
          }
          begin += ` t={[${tagRefs.join(", ")}]}`;
        }

        begin += " x=";
        if (this.inCompoundText) {
          begin += `{${this.vars().nestCtx}} n`;
        } else {
          const index = this.index.get(msgInfo.toKey());
          begin += `{${this.vars().rtCtx}(${index})}`;
        }
        let end = " />";
        if (hasExprs) {
          begin += " a={[";
          end = "]}" + end;
        }
        this.mstr.appendLeft(lastChildEnd, begin);
        this.mstr.appendRight(lastChildEnd, end);
      },
    });

  visitChildren = (node: ParentNode): Message[] => {
    if (!("children" in node) || !node.children) {
      return [];
    }
    return this.mixedVisitor.visit({
      children: node.children as MixedAstroNodes[],
      commentDirectives: this.commentDirectives,
      inCompoundText: this.inCompoundText,
      scope: "markup",
      element: this.currentElement as string,
    });
  };

  visitTextNode = (node: TextNode): Message[] => {
    const [, trimmed] = nonWhitespaceText(node.value);
    if (!trimmed) {
      return [];
    }
    // Skip text that looks like a string literal (quotes on both ends)
    // This prevents double-bracing when text nodes inside expressions are processed
    if (/^(["'`]).+\1$/s.test(trimmed)) {
      return [];
    }
    const [pass, msgInfo] = this.checkHeuristic(trimmed, {
      scope: "markup",
      element: this.currentElement,
    });
    if (!pass) {
      return [];
    }
    // Use node offset as a starting point, but find the actual text in content
    // This handles byte-offset vs character-offset mismatches (UTF-8 multi-byte chars)
    const approxStart = node.position?.start?.offset ?? 0;
    // Search for the trimmed text in the vicinity of the approximate position
    const searchStart = Math.max(0, approxStart - 50);
    const searchEnd = Math.min(
      this.content.length,
      approxStart + node.value.length + 50
    );
    const searchRegion = this.content.slice(searchStart, searchEnd);
    const textIndex = searchRegion.indexOf(trimmed);
    if (textIndex === -1) {
      return []; // Couldn't find text, skip
    }
    const start = searchStart + textIndex;
    const end = start + trimmed.length;
    this.mstr.update(
      start,
      end,
      `{${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`
    );
    return [msgInfo];
  };

  visitElementNode = (node: ElementNode | ComponentNode): Message[] => {
    const currentElement = this.currentElement;
    this.currentElement = node.name;

    // Transform attributes first (for consistent index ordering)
    const msgs: Message[] = [];
    for (const attr of node.attributes) {
      msgs.push(...this.visitAttribute(attr));
    }

    // Then process children
    msgs.push(...this.visitChildren(node));

    this.currentElement = currentElement;
    return msgs;
  };

  /**
   * Visit spread attributes like {...props} or {...{title: "Hello"}}
   * The value contains the expression after the ...
   */
  visitSpreadAttribute = (attr: AttributeNode): Message[] => {
    if (!attr.value) {
      return [];
    }

    // Parse the spread expression using Acorn
    const TsParser = Parser.extend(tsPlugin());
    const [opts] = scriptParseOptionsWithComments();

    let exprAst: Estree.Program;
    try {
      // Wrap in parentheses to parse as expression
      exprAst = TsParser.parse(`(${attr.value})`, opts);
    } catch {
      // Can't parse, skip
      return [];
    }

    // Get the expression from the program
    const exprStmt = exprAst.body[0];
    if (exprStmt?.type !== "ExpressionStatement") {
      return [];
    }

    // Find the spread in source to get offset for transformations
    const attrStart = attr.position?.start?.offset;
    if (attrStart == null) {
      return [];
    }

    // The spread looks like {...expr} in source
    // We need to find where the expression starts after {...
    const searchContent = this.content.slice(attrStart);
    const spreadMatch = searchContent.match(/^\{\s*\.\.\./);
    if (!spreadMatch) {
      return [];
    }

    // Calculate offset: position of { + length of {...
    // The parsed expression positions are 0-based from (expr)
    // We need to adjust by attrStart + spreadMatch.length - 1 (for the added '(')
    const contentOffset = attrStart + spreadMatch[0].length - 1;

    // Use offset-adjusted MagicString
    const originalMstr = this.mstr;
    this.mstr = this.createOffsetMstr(contentOffset);

    const msgs: Message[] = [];
    try {
      msgs.push(...this.visit(exprStmt.expression as Estree.AnyNode));
    } finally {
      this.mstr = originalMstr;
    }

    return msgs;
  };

  visitAttribute = (attr: AttributeNode): Message[] => {
    // Handle spread attributes: {...props} or {...{title: "Hello"}}
    if (attr.kind === "spread") {
      return this.visitSpreadAttribute(attr);
    }

    // Skip Astro directives (client:, is:, set:, transition:, etc.)
    if (attr.name.includes(":")) {
      return [];
    }

    // Handle quoted string attributes: title="string"
    if (attr.kind === "quoted" && attr.value) {
      const [pass, msgInfo] = this.checkHeuristic(attr.value, {
        scope: "script" as "script",
        element: this.currentElement,
        attribute: attr.name,
      });
      if (!pass) {
        return [];
      }

      const attrStart = attr.position?.start?.offset;
      if (attrStart == null) {
        return [];
      }

      // Astro compiler doesn't provide end position for attributes
      // Find the attribute end by searching for the closing quote
      const searchContent = this.content.slice(attrStart);
      // Match: name="value" or name='value'
      const attrMatch = searchContent.match(
        /^[\w.-]+\s*=\s*(["'])(?:[^"'\\]|\\.)*\1/
      );
      if (!attrMatch) {
        return [];
      }
      const attrEnd = attrStart + attrMatch[0].length;

      const attrContent = attrMatch[0];
      const valueMatch = attrContent.match(/=\s*["'](.*)["']$/);
      if (valueMatch) {
        const valueStart = attrStart + attrContent.indexOf(valueMatch[0]);
        this.mstr.update(
          valueStart,
          attrEnd,
          `={${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`
        );
      }

      return [msgInfo];
    }

    // Handle expression attributes with string literals: title={"string"} or title={'string'}
    if (attr.kind === "expression" && attr.value) {
      const exprContent = attr.value.trim();

      // Check for simple string literal (single or double quoted)
      const stringMatch = exprContent.match(/^(["'])(.+)\1$/);
      if (!stringMatch) {
        return []; // Not a simple string literal, skip (could be variable, template, etc.)
      }

      const stringValue = stringMatch[2];

      const [pass, msgInfo] = this.checkHeuristic(stringValue, {
        scope: "script" as "script",
        element: this.currentElement,
        attribute: attr.name,
      });
      if (!pass) {
        return [];
      }

      const attrStart = attr.position?.start?.offset;
      if (attrStart == null) {
        return [];
      }

      // For expression attributes, we need to find the end by searching for the closing brace
      // The format is: name={value} where value is our string literal
      const searchContent = this.content.slice(attrStart);

      // Find where the opening brace is (after name=)
      const braceMatch = searchContent.match(/^[\w.-]+\s*=\s*\{/);
      if (!braceMatch) {
        return [];
      }

      // Find the matching closing brace using proper string-aware matching
      const openBracePos = attrStart + braceMatch[0].length - 1; // Position of {
      const attrEnd = findMatchingBrace(this.content, openBracePos);
      if (attrEnd === -1) {
        return [];
      }

      // Find where the = starts to calculate the replacement range
      const eqIndex = braceMatch[0].indexOf("=");
      const valueStart = attrStart + eqIndex;
      this.mstr.update(
        valueStart,
        attrEnd,
        `={${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`
      );

      return [msgInfo];
    }

    return [];
  };

  visitCommentNode = (node: CommentNode): Message[] => {
    const value = (node as any).value || "";
    const commentContents = value.trim();
    if (!commentContents) {
      return [];
    }
    this.commentDirectives = processCommentDirectives(
      commentContents,
      this.commentDirectives
    );
    if (this.lastVisitIsComment) {
      this.commentDirectivesStack[this.commentDirectivesStack.length - 1] =
        this.commentDirectives;
    } else {
      this.commentDirectivesStack.push(this.commentDirectives);
    }
    this.lastVisitIsComment = true;
    return [];
  };

  visitAstroNode = (node: AstroNode): Message[] => {
    // Skip whitespace-only text nodes
    if (is.text(node) && !node.value.trim()) {
      return [];
    }

    // Handle comments
    if (is.comment(node)) {
      return this.visitCommentNode(node);
    }

    let msgs: Message[] = [];
    const commentDirectivesPrev = this.commentDirectives;
    if (this.lastVisitIsComment) {
      this.commentDirectives =
        this.commentDirectivesStack.pop() as CommentDirectives;
      this.lastVisitIsComment = false;
    }
    if (this.commentDirectives.ignoreFile) {
      return [];
    }
    if (this.commentDirectives.forceType !== false) {
      // Handle different node types
      if (is.text(node)) {
        msgs = this.visitTextNode(node);
      } else if (
        is.element(node) ||
        is.component(node) ||
        is.customElement(node)
      ) {
        msgs = this.visitElementNode(node as ElementNode);
      } else if (is.fragment(node)) {
        msgs = this.visitChildren(node);
      } else if (is.expression(node)) {
        // Expression nodes contain template expressions like {someVar}
        if ("children" in node) {
          // Special handling for string literals like {"text"} or {'text'}
          if (node.children.length === 1 && is.text(node.children[0])) {
            const textNode = node.children[0] as TextNode;
            const textValue = textNode.value.trim();
            const stringMatch = textValue.match(/^(["'])(.+)\1$/s);
            if (stringMatch) {
              // This is a string literal expression
              const stringValue = stringMatch[2];
              const [pass, msgInfo] = this.checkHeuristic(stringValue, {
                scope: "markup",
                element: this.currentElement,
              });
              if (pass) {
                let start = node.position?.start?.offset;
                if (start == null) {
                  return msgs; // Skip if no start position
                }
                // Astro parser may report position before the opening brace
                // Find the actual opening brace
                while (
                  start < this.content.length &&
                  this.content[start] !== "{"
                ) {
                  start++;
                }
                // Find the closing brace using proper string-aware matching
                const end = findMatchingBrace(this.content, start);
                // Skip if we couldn't find the closing brace
                if (end === -1) {
                  return msgs;
                }
                // Replace entire {"..."} with {translated}
                this.mstr.update(
                  start,
                  end,
                  `{${this.vars().rtTrans}(${this.index.get(msgInfo.toKey())})}`
                );
                msgs.push(msgInfo);
              }
              return msgs; // Don't process children
            }
          }
          // Not a simple string literal expression
          // Don't process children - complex expressions contain JavaScript code
          // that should be handled by the frontmatter transformer, not visitTextNode
          // This prevents breaking ternaries, logical expressions, etc.
        }
      } else if (is.parent(node)) {
        msgs = this.visitChildren(node);
      }
    }
    this.commentDirectives = commentDirectivesPrev;
    return msgs;
  };

  async transformAstro(): Promise<TransformOutput> {
    // Parse the Astro file
    const { ast } = await parse(this.content, { position: true });

    this.mstr = new MagicString(this.content);
    this.mixedVisitor = this.initMixedVisitor();

    // Reset wrapper generation state
    this.wrapperMetadata = new Map();
    this.wrapperCounter = 0;

    const allMsgs: Message[] = [];

    // Find and process frontmatter first
    let frontmatterNode: FrontmatterNode | null = null;
    for (const child of ast.children) {
      if (is.frontmatter(child)) {
        frontmatterNode = child;
        break;
      }
    }

    if (frontmatterNode) {
      this.frontmatterStart = frontmatterNode.position?.start?.offset ?? 0;
      this.frontmatterEnd = frontmatterNode.position?.end?.offset ?? 0;
      this.frontmatterContent = frontmatterNode.value;

      // Transform the frontmatter code
      const frontmatterMsgs = await this.transformFrontmatter(frontmatterNode);
      allMsgs.push(...frontmatterMsgs);
    }

    // Walk the template (everything except frontmatter)
    for (const child of ast.children) {
      if (!is.frontmatter(child)) {
        const templateMsgs = this.visitAstroNode(child);
        allMsgs.push(...templateMsgs);
      }
    }

    // Inject runtime import and initialization
    this.injectRuntime(frontmatterNode);

    return this.finalizeAstro(allMsgs);
  }

  /**
   * Creates an offset-adjusted MagicString wrapper.
   * All position operations are offset by the given amount.
   * This is safer than monkey-patching the original methods.
   */
  private createOffsetMstr(offset: number): MagicString {
    const original = this.mstr;
    // Use Proxy to intercept position-based operations
    return new Proxy(original, {
      get(target, prop) {
        const value = target[prop as keyof MagicString];
        if (typeof value !== "function") return value;

        // Offset position arguments for these methods
        switch (prop) {
          case "update":
            return (start: number, end: number, content: string) =>
              target.update(start + offset, end + offset, content);
          case "appendLeft":
            return (pos: number, content: string) =>
              target.appendLeft(pos + offset, content);
          case "appendRight":
            return (pos: number, content: string) =>
              target.appendRight(pos + offset, content);
          case "prependLeft":
            return (pos: number, content: string) =>
              target.prependLeft(pos + offset, content);
          case "prependRight":
            return (pos: number, content: string) =>
              target.prependRight(pos + offset, content);
          case "overwrite":
            return (start: number, end: number, content: string) =>
              target.overwrite(start + offset, end + offset, content);
          case "remove":
            return (start: number, end: number) =>
              target.remove(start + offset, end + offset);
          default:
            return value.bind(target);
        }
      },
    }) as MagicString;
  }

  async transformFrontmatter(node: FrontmatterNode): Promise<Message[]> {
    const scriptContent = node.value;
    if (!scriptContent.trim()) {
      return [];
    }

    // The frontmatter content starts after the opening ---
    // node.value is the content between --- delimiters, including the leading newline
    // Find the actual position of --- in the file content
    const frontmatterStart = node.position?.start?.offset ?? 0;
    const searchContent = this.content.slice(frontmatterStart);
    // Match optional whitespace, then ---, then optional whitespace/newline before content
    const dashMatch = searchContent.match(/^[\s]*---/);
    const contentOffset =
      frontmatterStart + (dashMatch ? dashMatch[0].length : 3);

    // Parse the script content with Acorn (TypeScript support)
    const TsParser = Parser.extend(tsPlugin());
    const [opts, comments] = scriptParseOptionsWithComments();

    let scriptAst: Estree.Program;
    try {
      scriptAst = TsParser.parse(scriptContent, {
        ...opts,
        allowReturnOutsideFunction: true,
      });
    } catch (e) {
      // If parsing fails, skip frontmatter transformation
      console.warn(`Failed to parse frontmatter in ${this.filename}:`, e);
      return [];
    }

    this.comments = comments;

    // Use offset-adjusted MagicString for frontmatter transformation
    // This is cleaner than monkey-patching the original methods
    const originalMstr = this.mstr;
    this.mstr = this.createOffsetMstr(contentOffset);

    const msgs: Message[] = [];
    try {
      // Visit the script AST
      for (const statement of scriptAst.body) {
        msgs.push(...this.visit(statement as Estree.AnyNode));
      }
    } finally {
      // Always restore original mstr, even if an exception occurs
      this.mstr = originalMstr;
    }

    return msgs;
  }

  injectRuntime(frontmatterNode: FrontmatterNode | null) {
    // Use catalogExpr.plain for the runtime initialization (consistent with base class pattern)
    // Add newline before const to ensure proper separation from header import
    const runtimeInit = `\nconst ${this.currentRtVar} = ${this.catalogExpr.plain};\n`;

    // Store content to add (will be inserted in finalizeAstro along with the loader import)
    // Wrapper imports are built dynamically in finalizeAstro based on loader path
    this.frontmatterAdditions = runtimeInit;

    if (frontmatterNode) {
      this.hadFrontmatter = true;
      const frontmatterStart = frontmatterNode.position?.start?.offset ?? 0;

      // Find the position after the opening --- and newline
      // The frontmatter format is: ---\n<content>\n---
      // Handle leading whitespace from template literals
      const searchContent = this.content.slice(frontmatterStart);
      const dashMatch = searchContent.match(/^[\s]*---[ \t]*\n?/);
      const insertOffset = dashMatch ? dashMatch[0].length : 4;
      this.headerInsertPos = frontmatterStart + insertOffset;
    } else {
      // No frontmatter exists - will be created in finalizeAstro
      this.hadFrontmatter = false;
      this.headerInsertPos = 0;
    }
  }

  finalizeAstro(msgs: Message[]): TransformOutput {
    const hasChanges = msgs.length > 0 || this.mstr.hasChanged();
    const mstr = this.mstr;
    const hadFrontmatter = this.hadFrontmatter;
    const headerInsertPos = this.headerInsertPos;
    const frontmatterAdditions = this.frontmatterAdditions;
    const wrapperMetadata = this.wrapperMetadata;
    const { componentImportPath } = this.config;

    return {
      output: (header: string) => {
        if (!hasChanges) {
          return {};
        }

        // Build wrapper imports and files dynamically using the loader path from header
        // Header format: import {getRuntime as _w_load_, ...} from "{loaderPath}"
        let wrapperImportsStr = "";
        let componentImport = "";
        const auxiliaryFiles: AuxiliaryFile[] = [];

        if (wrapperMetadata.size > 0) {
          // Extract the full loader path from header
          // Match: from "path/to/loader.js" or from 'path/to/loader.js'
          const loaderMatch = header.match(/from\s+["']([^"']+)["']/);
          const fullLoaderPath = loaderMatch ? loaderMatch[1] : "./astro.loader.js";

          // Split into base path and filename
          const lastSlash = fullLoaderPath.lastIndexOf("/");
          const loaderBasePath = lastSlash >= 0 ? fullLoaderPath.slice(0, lastSlash + 1) : "./";
          const loaderFilename = lastSlash >= 0 ? fullLoaderPath.slice(lastSlash + 1) : fullLoaderPath;

          // Build wrapper imports and generate files
          const wrapperImports: string[] = [];
          for (const [hash, metadata] of wrapperMetadata) {
            const filename = `w_${metadata.index}_${hash}.astro`;

            // Generate wrapper file content with correct loader import
            // Wrapper is in .wuchale/ subdirectory, so loader is one level up
            const wrapperContent = `---
// Generated wrapper component for nested translation element
export interface Props { ctx: any }
const { ctx } = Astro.props;
import { getRuntime as _w_load_ } from '../${loaderFilename}';
const _w_runtime_ = _w_load_('astro');
---
${metadata.transformedContent}
`;

            auxiliaryFiles.push({
              path: `.wuchale/${filename}`,
              content: wrapperContent,
              hash,
            });

            // Import in main file uses same base path as loader + .wuchale/
            wrapperImports.push(
              `import ${metadata.importName} from '${loaderBasePath}.wuchale/${filename}';`
            );
          }
          wrapperImportsStr = wrapperImports.join("\n") + "\n";

          // Import W_tx_ component
          componentImport = `import ${rtComponent} from "${componentImportPath}";\n`;
        }

        const fullAdditions = frontmatterAdditions + componentImport + wrapperImportsStr;

        // Insert the loader import (header) and runtime additions
        if (hadFrontmatter) {
          // Insert at the stored position inside existing frontmatter
          mstr.appendRight(headerInsertPos, header + fullAdditions);
        } else {
          // Create new frontmatter with header and additions
          mstr.prepend(`---\n${header}${fullAdditions}---\n\n`);
        }

        return {
          code: mstr.toString(),
          map: mstr.generateMap({ hires: true }),
          auxiliaryFiles: auxiliaryFiles.length > 0 ? auxiliaryFiles : undefined,
        };
      },
      msgs,
    };
  }
}
