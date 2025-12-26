/**
 * BraceMatcher - Finds matching closing braces while handling:
 * - Nested braces
 * - String literals (single, double, template)
 * - Escaped characters (including consecutive backslashes)
 * - Template literal ${} expressions
 */

type ContextType = "code" | "string-double" | "string-single" | "template";

export class BraceMatcher {
  private content: string;
  private position: number;
  private stack: ContextType[];
  private braceDepth: number;
  private templateExpressionDepths: number[]; // Track brace depth when entering each template expression

  constructor(content: string) {
    this.content = content;
    this.position = 0;
    this.stack = [];
    this.braceDepth = 0;
    this.templateExpressionDepths = [];
  }

  /**
   * Find matching closing brace from opening position.
   * @param openPos Position of the opening brace
   * @returns Position after the closing brace, or -1 if not found
   */
  findMatchingBrace(openPos: number): number {
    if (this.content[openPos] !== "{") return -1;

    this.position = openPos + 1;
    this.stack = ["code"];
    this.braceDepth = 1;

    while (this.position < this.content.length) {
      const context = this.stack[this.stack.length - 1];
      const result = this.processChar(context);
      if (result !== null) return result;
    }

    return -1;
  }

  private processChar(context: ContextType): number | null {
    switch (context) {
      case "string-double":
        return this.handleStringContext('"');
      case "string-single":
        return this.handleStringContext("'");
      case "template":
        return this.handleTemplateContext();
      case "code":
        return this.handleCodeContext();
    }
  }

  private handleStringContext(quote: string): null {
    const char = this.content[this.position];

    if (char === "\\") {
      this.position += 2; // Skip escape sequence
      return null;
    }

    if (char === quote) {
      this.stack.pop();
    }

    this.position++;
    return null;
  }

  private handleTemplateContext(): null {
    const char = this.content[this.position];

    if (char === "\\") {
      this.position += 2; // Skip escape sequence
      return null;
    }

    if (char === "`") {
      this.stack.pop();
      this.position++;
      return null;
    }

    if (
      char === "$" &&
      this.position + 1 < this.content.length &&
      this.content[this.position + 1] === "{"
    ) {
      // Enter template expression - treat as code context
      // Track the depth at which we enter so we know when to exit
      this.braceDepth++;
      this.templateExpressionDepths.push(this.braceDepth);
      this.stack.push("code");
      this.position += 2;
      return null;
    }

    this.position++;
    return null;
  }

  private handleCodeContext(): number | null {
    const char = this.content[this.position];

    switch (char) {
      case '"':
        this.stack.push("string-double");
        break;
      case "'":
        this.stack.push("string-single");
        break;
      case "`":
        this.stack.push("template");
        break;
      case "{":
        this.braceDepth++;
        break;
      case "}":
        this.braceDepth--;
        if (this.braceDepth === 0) {
          return this.position + 1; // Position after closing brace
        }
        // Pop code context only if this brace closes a template expression
        // (i.e., we're back to the depth at which we entered the template expression)
        if (
          this.templateExpressionDepths.length > 0 &&
          this.braceDepth === this.templateExpressionDepths[this.templateExpressionDepths.length - 1] - 1
        ) {
          this.templateExpressionDepths.pop();
          this.stack.pop();
        }
        break;
    }

    this.position++;
    return null;
  }
}

/**
 * Find the position of the matching closing brace.
 * Standalone function for backward compatibility.
 *
 * @param content The content to search in
 * @param openPos Position of the opening brace
 * @returns Position after the closing brace, or -1 if not found
 */
export function findMatchingBrace(content: string, openPos: number): number {
  return new BraceMatcher(content).findMatchingBrace(openPos);
}
