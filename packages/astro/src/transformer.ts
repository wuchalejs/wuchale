import MagicString from "magic-string";
import { Parser } from "acorn";
import { Message } from "wuchale";
import { tsPlugin } from "@sveltejs/acorn-typescript";
import jsx from "acorn-jsx";
import type * as Estree from "acorn";
import { createHash } from "node:crypto";
import { dirname, resolve, relative } from "node:path";
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
  // Store wrapper metadata for later file generation (hash -> { importName, transformedContent, expressions })
  private wrapperMetadata: Map<
    string,
    {
      importName: string;
      transformedContent: string;
      index: number;
      expressions: string[]; // expressions extracted from wrapper content
    }
  > = new Map();
  private wrapperCounter: number = 0;

  // Frontmatter position tracking
  frontmatterStart: number = 0;
  frontmatterEnd: number = 0;
  frontmatterContent: string = "";

  // Component imports extracted from frontmatter (for wrapper files)
  // Stores both the original source text and parsed AST info
  private componentImports: Array<{
    source: string; // Original import statement text
    modulePath: string; // The module path (e.g., "./Button.astro")
    defaultName?: string; // Default import name (e.g., "Button")
    namedImports?: string[]; // Named imports (e.g., ["foo", "bar"])
  }> = [];

  // Position to insert the loader import header (inside frontmatter)
  private headerInsertPos: number = 0;

  // Whether the original file had frontmatter
  private hadFrontmatter: boolean = false;

  // Content to add to frontmatter (runtime init, imports, etc.)
  private frontmatterAdditions: string = "";

  // Track if W_tx_ component is used (for expressions in compound text or nested elements)
  private usesRtComponent: boolean = false;

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
   * Built-in globals that don't need to be passed as props
   */
  private static readonly BUILTIN_GLOBALS = new Set([
    // Literals
    "undefined",
    "null",
    "NaN",
    "Infinity",
    // Constructors/globals
    "Object",
    "Array",
    "String",
    "Number",
    "Boolean",
    "Symbol",
    "BigInt",
    "Function",
    "Promise",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Date",
    "RegExp",
    "Error",
    "TypeError",
    "ReferenceError",
    "SyntaxError",
    "JSON",
    "Math",
    "console",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "encodeURI",
    "decodeURI",
    "encodeURIComponent",
    "decodeURIComponent",
    // Astro globals available in components
    "Astro",
    "Fragment",
  ]);

  /**
   * Extract free variable references from an AST node.
   * Returns identifiers that reference outer scope (not property names, not bound variables).
   */
  private extractFreeVariables(
    node: any,
    boundVars: Set<string> = new Set()
  ): string[] {
    const freeVars: string[] = [];

    const walk = (n: any, bound: Set<string>) => {
      if (!n || typeof n !== "object") return;

      switch (n.type) {
        case "Identifier":
          // Skip if it's a built-in global or already bound
          if (
            !AstroTransformer.BUILTIN_GLOBALS.has(n.name) &&
            !bound.has(n.name)
          ) {
            freeVars.push(n.name);
          }
          break;

        case "MemberExpression":
          // Only walk the object, not the property (unless computed)
          walk(n.object, bound);
          if (n.computed) {
            walk(n.property, bound);
          }
          break;

        case "ArrowFunctionExpression":
        case "FunctionExpression":
          // Add parameters to bound variables
          const newBound = new Set(bound);
          for (const param of n.params) {
            this.collectBindings(param, newBound);
          }
          walk(n.body, newBound);
          break;

        case "FunctionDeclaration":
          // Function name is bound, plus parameters
          const fnBound = new Set(bound);
          if (n.id) fnBound.add(n.id.name);
          for (const param of n.params) {
            this.collectBindings(param, fnBound);
          }
          walk(n.body, fnBound);
          break;

        case "VariableDeclaration":
          // Process declarations - values can reference outer scope
          for (const decl of n.declarations) {
            if (decl.init) walk(decl.init, bound);
            // Add declared variables to bound set for subsequent statements
            this.collectBindings(decl.id, bound);
          }
          break;

        case "Property":
          // For object literals, only walk value (key is not a reference unless computed)
          if (n.computed) walk(n.key, bound);
          walk(n.value, bound);
          break;

        case "MethodDefinition":
          if (n.computed) walk(n.key, bound);
          walk(n.value, bound);
          break;

        // JSX node types - need special handling to avoid treating tag/attribute names as variables
        case "JSXIdentifier":
          // JSX identifiers are tag names or attribute names, not variable references
          // Skip them - they're not free variables
          break;

        case "JSXMemberExpression":
          // e.g., <Foo.Bar /> - these are component references, walk object but not property
          walk(n.object, bound);
          break;

        case "JSXNamespacedName":
          // e.g., <svg:path /> - namespace names, not variables
          break;

        case "JSXElement":
        case "JSXFragment":
          // Walk children only (opening/closing elements handled by their own cases)
          if (n.children) {
            for (const child of n.children) walk(child, bound);
          }
          // For JSXElement, also walk the opening element for spread attributes
          if (n.openingElement) walk(n.openingElement, bound);
          break;

        case "JSXOpeningElement":
        case "JSXOpeningFragment":
          // Walk attributes (may contain expressions), but NOT the element name
          if (n.attributes) {
            for (const attr of n.attributes) walk(attr, bound);
          }
          break;

        case "JSXClosingElement":
        case "JSXClosingFragment":
          // No variables to extract from closing tags
          break;

        case "JSXAttribute":
          // Only walk the value, not the name (name is an attribute name, not a variable)
          if (n.value) walk(n.value, bound);
          break;

        case "JSXSpreadAttribute":
          // The argument IS a variable reference
          walk(n.argument, bound);
          break;

        case "JSXExpressionContainer":
          // The expression inside {} - THIS is where variables live
          if (n.expression && n.expression.type !== "JSXEmptyExpression") {
            walk(n.expression, bound);
          }
          break;

        case "JSXText":
        case "JSXEmptyExpression":
          // No variables in text or empty expressions
          break;

        default:
          // Walk all child nodes
          for (const key of Object.keys(n)) {
            if (
              key === "type" ||
              key === "start" ||
              key === "end" ||
              key === "loc"
            )
              continue;
            const child = n[key];
            if (Array.isArray(child)) {
              for (const c of child) walk(c, bound);
            } else if (child && typeof child === "object" && child.type) {
              walk(child, bound);
            }
          }
      }
    };

    walk(node, boundVars);
    return [...new Set(freeVars)]; // Deduplicate
  }

  /**
   * Collect variable bindings from a pattern (handles destructuring, rest, etc.)
   */
  private collectBindings(pattern: any, bound: Set<string>): void {
    if (!pattern) return;

    switch (pattern.type) {
      case "Identifier":
        bound.add(pattern.name);
        break;
      case "ObjectPattern":
        for (const prop of pattern.properties) {
          if (prop.type === "RestElement") {
            this.collectBindings(prop.argument, bound);
          } else {
            this.collectBindings(prop.value, bound);
          }
        }
        break;
      case "ArrayPattern":
        for (const elem of pattern.elements) {
          if (elem) this.collectBindings(elem, bound);
        }
        break;
      case "RestElement":
        this.collectBindings(pattern.argument, bound);
        break;
      case "AssignmentPattern":
        this.collectBindings(pattern.left, bound);
        break;
    }
  }

  /**
   * Extract expressions from content and replace variable references with array indices.
   * For simple expressions like {foo}, extracts the whole expression.
   * For complex expressions like {foo + bar}, extracts free variables and replaces them.
   *
   * @returns Tuple of [transformedContent, expressions[]]
   */
  private extractExpressionsFromContent(content: string): [string, string[]] {
    const expressions: string[] = [];
    const exprToIndex = new Map<string, number>();
    // Extend parser with both TypeScript and JSX support for expressions like (<a>{locale}</a>)
    const TsJsxParser = Parser.extend(tsPlugin(), jsx());
    const [opts] = scriptParseOptionsWithComments();

    // Helper to get or create index for an expression
    const getExprIndex = (expr: string): number => {
      if (exprToIndex.has(expr)) {
        return exprToIndex.get(expr)!;
      }
      const idx = expressions.length;
      expressions.push(expr);
      exprToIndex.set(expr, idx);
      return idx;
    };

    // Find all {expression} blocks in content
    let result = "";
    let lastIndex = 0;
    let braceStart = content.indexOf("{");

    while (braceStart !== -1) {
      // Add content before the brace
      result += content.slice(lastIndex, braceStart);

      // Find matching closing brace
      const braceEnd = findMatchingBrace(content, braceStart);
      if (braceEnd === -1) {
        // No matching brace, keep rest of content as-is
        result += content.slice(braceStart);
        lastIndex = content.length;
        break;
      }

      // Extract expression content (without braces)
      const exprContent = content.slice(braceStart + 1, braceEnd - 1);
      const trimmedExpr = exprContent.trim();

      // Skip runtime calls (already transformed)
      if (trimmedExpr.startsWith("_w_runtime_")) {
        result += content.slice(braceStart, braceEnd);
        lastIndex = braceEnd;
        braceStart = content.indexOf("{", lastIndex);
        continue;
      }

      // Try to parse as expression
      try {
        const ast = TsJsxParser.parse(`(${trimmedExpr})`, opts);
        const stmt = ast.body[0];
        if (stmt?.type === "ExpressionStatement") {
          const expr = stmt.expression;

          // Check if it's a simple identifier: {foo}
          if (expr.type === "Identifier") {
            const idx = getExprIndex(expr.name);
            result += `{a[${idx}]}`;
          }
          // Check if it's a simple member expression: {foo.bar}
          else if (expr.type === "MemberExpression" && !expr.computed) {
            // Reconstruct the dotted path
            const parts: string[] = [];
            let current: any = expr;
            let isSimple = true;
            while (current.type === "MemberExpression" && !current.computed) {
              if (current.property.type === "Identifier") {
                parts.unshift(current.property.name);
                current = current.object;
              } else {
                isSimple = false;
                break;
              }
            }
            if (isSimple && current.type === "Identifier") {
              parts.unshift(current.name);
              const fullPath = parts.join(".");
              const idx = getExprIndex(fullPath);
              result += `{a[${idx}]}`;
            } else {
              // Complex member expression - extract free variables
              const freeVars = this.extractFreeVariables(expr);
              let newExpr = trimmedExpr;
              for (const v of freeVars) {
                const idx = getExprIndex(v);
                // Escape special regex chars and use lookbehind/lookahead for JS identifiers (including $)
                const escapedVar = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                newExpr = newExpr.replace(
                  new RegExp(`(?<![a-zA-Z0-9_$])${escapedVar}(?![a-zA-Z0-9_$])`, "g"),
                  `a[${idx}]`
                );
              }
              result += `{${newExpr}}`;
            }
          }
          // Complex expression - extract free variables and replace
          else {
            const freeVars = this.extractFreeVariables(expr);
            if (freeVars.length === 0) {
              // No free variables, keep as-is
              result += content.slice(braceStart, braceEnd);
            } else {
              let newExpr = trimmedExpr;
              for (const v of freeVars) {
                const idx = getExprIndex(v);
                // Escape special regex chars and use lookbehind/lookahead for JS identifiers (including $)
                const escapedVar = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                newExpr = newExpr.replace(
                  new RegExp(`(?<![a-zA-Z0-9_$])${escapedVar}(?![a-zA-Z0-9_$])`, "g"),
                  `a[${idx}]`
                );
              }
              result += `{${newExpr}}`;
            }
          }
        } else {
          // Not an expression statement, keep as-is
          result += content.slice(braceStart, braceEnd);
        }
      } catch {
        // Parse error - not a valid expression, keep as-is
        result += content.slice(braceStart, braceEnd);
      }

      lastIndex = braceEnd;
      braceStart = content.indexOf("{", lastIndex);
    }

    // Add remaining content
    result += content.slice(lastIndex);

    return [result, expressions];
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
  ): { importName: string; expressions: string[] } {
    // Create a content hash for deduplication (based on original content + hasContext)
    const hash = createHash("md5")
      .update(originalContent + (hasContext ? "_ctx" : ""))
      .digest("hex")
      .slice(0, 8);

    // Check if we already have a wrapper with this content
    if (this.wrapperMetadata.has(hash)) {
      const meta = this.wrapperMetadata.get(hash)!;
      return { importName: meta.importName, expressions: meta.expressions };
    }

    const index = this.wrapperCounter;
    const importName = `_w_tag_${index}`;
    this.wrapperCounter++;

    // Transform content: only replace text with tx(ctx) if hasContext is true
    // If hasContext is false, keep original text (it's not translatable)
    let transformedContent = hasContext
      ? this.transformWrapperContent(originalContent)
      : originalContent;

    // Extract expressions from wrapper content using AST parsing
    // Extracts all free variable references and replaces them with array indices
    const [contentWithReplacedExprs, expressions] =
      this.extractExpressionsFromContent(transformedContent);
    transformedContent = contentWithReplacedExprs;

    // Store metadata - actual file content is generated in finalizeAstro
    this.wrapperMetadata.set(hash, {
      importName,
      transformedContent,
      index,
      expressions,
    });

    return { importName, expressions };
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
      getRange: (node) => {
        const start = node.position?.start?.offset ?? 0;
        const end = node.position?.end?.offset ?? 0;

        // For expression nodes, Astro parser returns incorrect positions
        // Find actual { and } in the source content
        if (node.type === "expression") {
          // Find opening brace (parser may report position before it)
          let actualStart = start;
          while (
            actualStart < this.content.length &&
            this.content[actualStart] !== "{"
          ) {
            actualStart++;
          }
          // Find closing brace using string-aware matching
          const actualEnd = findMatchingBrace(this.content, actualStart);
          if (actualEnd !== -1) {
            return { start: actualStart, end: actualEnd };
          }
        }

        return { start, end };
      },
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
        this.usesRtComponent = true;
        let begin = `<${rtComponent}`;
        const tagRefs: string[] = [];
        const wrapperExpressions: string[] = []; // expressions from nested wrappers

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
            wrapperExpressions.push(...wrapper.expressions);

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
        // Include expressions from wrapper content + sibling expressions
        const hasAnyExprs = hasExprs || wrapperExpressions.length > 0;
        if (hasAnyExprs) {
          // Add wrapper expressions first, then sibling expressions will be moved here
          const wrapperExprsStr = wrapperExpressions.join(", ");
          begin += ` a={[${wrapperExprsStr}${
            wrapperExpressions.length > 0 && hasExprs ? ", " : ""
          }`;
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

      // Transform the frontmatter code (also extracts component imports via AST)
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

  /**
   * Extract imports from parsed AST.
   * Returns structured import info for each ImportDeclaration node.
   */
  private extractImportsFromAst(
    ast: Estree.Program,
    scriptContent: string
  ): typeof this.componentImports {
    const imports: typeof this.componentImports = [];

    for (const node of ast.body) {
      if (node.type !== "ImportDeclaration") continue;

      const modulePath = node.source.value as string;

      // Skip wuchale imports (loader, runtime) which are added separately
      if (modulePath.includes("wuchale") || modulePath.includes("_w_")) {
        continue;
      }

      // Extract original source text using AST positions
      const source = scriptContent.slice(
        (node as any).start,
        (node as any).end
      );

      // Extract default import name
      let defaultName: string | undefined;
      const namedImports: string[] = [];

      for (const spec of node.specifiers) {
        if (spec.type === "ImportDefaultSpecifier") {
          defaultName = spec.local.name;
        } else if (spec.type === "ImportSpecifier") {
          namedImports.push(spec.local.name);
        }
      }

      imports.push({
        source,
        modulePath,
        defaultName,
        namedImports: namedImports.length > 0 ? namedImports : undefined,
      });
    }

    return imports;
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

    // Extract component imports from AST (replaces regex-based extraction)
    this.componentImports = this.extractImportsFromAst(
      scriptAst,
      scriptContent
    );

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
    const usesRtComponent = this.usesRtComponent;
    const componentImports = this.componentImports;
    const sourceFilename = this.filename;
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

        // Import W_tx_ component if used (for expressions in compound text or nested elements)
        if (usesRtComponent) {
          componentImport = `import ${rtComponent} from "${componentImportPath}";\n`;
        }

        if (wrapperMetadata.size > 0) {
          // Extract the full loader path from header
          // Match: from "path/to/loader.js" or from 'path/to/loader.js'
          const loaderMatch = header.match(/from\s+["']([^"']+)["']/);
          const fullLoaderPath = loaderMatch
            ? loaderMatch[1]
            : "./astro.loader.js";

          // Split into base path and filename
          const lastSlash = fullLoaderPath.lastIndexOf("/");
          const loaderBasePath =
            lastSlash >= 0 ? fullLoaderPath.slice(0, lastSlash + 1) : "./";
          const loaderFilename =
            lastSlash >= 0
              ? fullLoaderPath.slice(lastSlash + 1)
              : fullLoaderPath;

          // Build wrapper imports and generate files
          const wrapperImports: string[] = [];
          const sourceDir = dirname(sourceFilename);

          for (const [hash, metadata] of wrapperMetadata) {
            const filename = `w_${metadata.index}_${hash}.astro`;

            // Filter imports to only include ones used in this wrapper's content
            // Uses pre-parsed AST data instead of regex for robustness
            const usedImports = componentImports
              .filter((imp) => {
                // Check if default import is used as a component
                if (imp.defaultName) {
                  // Look for <ComponentName or <ComponentName> patterns
                  return new RegExp(`<${imp.defaultName}[\\s/>]`).test(
                    metadata.transformedContent
                  );
                }
                return false; // Skip named imports for now
              })
              .map((imp) => {
                // Adjust relative paths for wrapper location
                if (
                  imp.modulePath.startsWith("./") ||
                  imp.modulePath.startsWith("../")
                ) {
                  const absolutePath = resolve(sourceDir, imp.modulePath);
                  const wrapperDir = resolve(
                    sourceDir,
                    loaderBasePath,
                    ".wuchale"
                  );
                  const newRelativePath = relative(wrapperDir, absolutePath);
                  const normalizedPath = newRelativePath.startsWith(".")
                    ? newRelativePath
                    : "./" + newRelativePath;
                  // Replace the module path in the original source
                  return imp.source.replace(imp.modulePath, normalizedPath);
                }
                return imp.source;
              })
              .join("\n");

            // Generate wrapper file content with correct loader import
            // Wrapper is in .wuchale/ subdirectory, so loader is one level up
            const wrapperContent = `---
// Generated wrapper component for nested translation element
export interface Props { ctx: any; a?: any[] }
const { ctx, a = [] } = Astro.props;
import { getRuntime as _w_load_ } from '../${loaderFilename}';
const _w_runtime_ = _w_load_('astro');
${usedImports}
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
        }

        const fullAdditions =
          frontmatterAdditions + componentImport + wrapperImportsStr;

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
          auxiliaryFiles:
            auxiliaryFiles.length > 0 ? auxiliaryFiles : undefined,
        };
      },
      msgs,
    };
  }
}
